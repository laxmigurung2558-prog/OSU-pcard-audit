"""Local Gemini question interpreter for the OSU P-Card audit website.

Runs locally and keeps GEMINI_API_KEY on the server. It never executes
model-generated SQL and never sends transaction records to Gemini.
"""
import json
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from google import genai
from google.genai import types

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
app = Flask(__name__, static_folder=None)

SYSTEM_INSTRUCTIONS = """You are a question interpreter for an internal audit of purchasing-card transactions.
Convert the user's question to a single JSON object containing ONLY these keys:
  intent: one of 'list', 'count', 'sum', 'group', 'unknown'
  year: an integer from 2010 through 2014, default 2014
  field: one of 'Description', 'Vendor', 'MCC', 'FullName', 'Amount', 'TransactionDate', 'none'
  keyword: a string (possibly empty)
  group_by: one of 'FullName', 'Vendor', 'MCC', 'none'
  min_amount: number or null
  max_amount: number or null
  sort: one of 'amount_desc', 'amount_asc', 'count_desc', 'total_desc', 'date_asc'
  limit: integer from 1 to 100, default 50
Use 'group' for spending by vendor or employee. Use 'sum' for total spending; 'count' for how many transactions.
Use 'list' for showing transactions. For a plain vendor name search, field='Vendor'.
For insurance or alcohol transactions when unspecified, field='MCC' and keyword=the relevant term.
Only interpret the question; do not fabricate transaction results and do not output SQL.
All records already belong to Oklahoma State University. Mentions of Oklahoma State University, OSU, or the university refer to the agency, NOT the vendor, cardholder, or keyword. Do not add a Vendor filter for these mentions.
For strict comparisons such as 'exceeded', 'over', 'above', 'more than', return a numeric threshold; the server will enforce the strict operator.
For requests outside the supported analysis return intent='unknown'.
Return JSON only.
"""

@app.post('/api/interpret')
def interpret():
    payload = request.get_json(silent=True) or {}
    question = str(payload.get('question', '')).strip()
    if not question or len(question) > 1000:
        return jsonify(error='Enter a question of at most 1,000 characters.'), 400
    # Deterministic handling for uncomplicated population-wide audit totals.
    # This works even when Gemini is unavailable, with no model-generated SQL.
    normalized = question.lower()
    asks_transaction_count = bool(re.search(
        r'\b(?:how many|number of|count|total number of)\b', normalized
    )) and bool(re.search(r'\b(?:transactions?|p[ -]?card (?:purchases|charges))\b', normalized))
    asks_total_spend = bool(re.search(
        r'\b(?:total|overall|aggregate)\b.{0,35}\b(?:spend(?:ing)?|amount|paid|payments|purchases)\b|'
        r'\b(?:how much|what amount)\b.{0,35}\b(?:spent|spending|paid)\b',
        normalized
    ))
    # Only use this fast path for simple, unfiltered population totals.
    # Filtered questions must not silently return the unfiltered count.
    has_specific_filter = bool(re.search(
        r'\$|\b(?:over|under|above|below|exceed|greater|less|between|at|from|to|by|per|'
        r'where|whose|which|vendor|merchant|employee|cardholder|duplicate|insurance|'
        r'alcohol|gift|postage|usps|amazon|restaurant|hotel|weekend|monthly|month)\b',
        normalized
    ))
    if not has_specific_filter and (asks_transaction_count or asks_total_spend):
        year_match = re.search(r'\b201[0-4]\b', question)
        year = int(year_match.group()) if year_match else 2014
        return jsonify({
            'intent': 'count' if asks_transaction_count else 'sum',
            'year': year, 'field': 'none', 'keyword': '', 'group_by': 'none',
            'min_amount': None, 'max_amount': None, 'min_exclusive': False,
            'sort': 'amount_desc', 'limit': 50,
        })
    # Deterministic handling of Part II Control 1: this must not depend on
    # Gemini availability or interpretation. The browser calculates from data.
    annual_employee_query = (re.search(r'\b(?:employees?|cardholders?|people|staff)\b', question, re.I)
                             and re.search(r'\b(?:total|annual|during|spent|spending)\b', question, re.I)
                             and re.search(r'\$?50,?000\b', question))
    if annual_employee_query:
        match = re.search(r'\b201[0-4]\b', question)
        year = int(match.group()) if match else 2014
        return jsonify({
            'intent': 'group', 'year': year, 'field': 'none', 'keyword': '',
            'group_by': 'FullName', 'min_amount': None, 'max_amount': None,
            'min_exclusive': False, 'group_min_total': 50000.0,
            'group_min_exclusive': bool(re.search(
                r'\b(?:more than|over|exceed(?:ed|s|ing)?|above|greater than)\b',
                question, re.I)),
            'sort': 'total_desc', 'limit': 100,
        })
    key = os.getenv('GEMINI_API_KEY')
    if not key:
        return jsonify(error='Gemini API key is not configured on the server.'), 503
    try:
        client = genai.Client(api_key=key)
        reply = client.models.generate_content(
            model=os.getenv('GEMINI_MODEL', 'gemini-flash-latest'),
            contents=question,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTIONS,
                response_mime_type='application/json',
                temperature=0,
            ),
        )
        obj = json.loads(reply.text)
        if not isinstance(obj, dict):
            raise ValueError('Expected a JSON object')
        allowed_intents = {'list', 'count', 'sum', 'group', 'unknown'}
        allowed_fields = {'Description', 'Vendor', 'MCC', 'FullName', 'Amount', 'TransactionDate', 'none'}
        allowed_groups = {'FullName', 'Vendor', 'MCC', 'none'}
        allowed_sort = {'amount_desc', 'amount_asc', 'count_desc', 'total_desc', 'date_asc'}
        if (obj.get('intent') not in allowed_intents or obj.get('field') not in allowed_fields
            or obj.get('group_by') not in allowed_groups or obj.get('sort') not in allowed_sort):
            raise ValueError('Unsupported query parameters')
        obj['year'] = int(obj.get('year', 2014))
        obj['limit'] = int(obj.get('limit', 50))
        if obj['year'] not in range(2010, 2015) or not 1 <= obj['limit'] <= 100:
            raise ValueError('Invalid year or limit')
        obj['keyword'] = str(obj.get('keyword') or '')[:200]
        # The data served by this application already contains OSU transactions only.
        # Avoid interpreting an agency reference as a vendor name.
        if obj['field'] in ('Vendor', 'FullName') and re.fullmatch(
            r'(?:oklahoma\s+state\s+university|osu|the\s+university)',
            obj['keyword'].strip(), flags=re.IGNORECASE
        ):
            obj['field'] = 'none'
            obj['keyword'] = ''
        # This case-study threshold specifically means Amount > $5,000.
        # Override ambiguous model interpretations for this audit control.
        if re.search(r'\b(?:exceed(?:ed|s|ing)?|over|above|more\s+than|greater\s+than)\s*\$?5,?000\b', question, re.I):
            obj['min_amount'] = 5000.0
            obj['min_exclusive'] = True
        else:
            obj['min_exclusive'] = False
        for k in ('min_amount', 'max_amount'):
            obj[k] = None if obj.get(k) is None else float(obj[k])
        # Annual per-cardholder spending controls: aggregate FIRST, filter totals SECOND.
        # This deterministic rule prevents Gemini from interpreting $50,000 as
        # a per-transaction threshold or an employee-name search.
        annual_employee_query = (re.search(r'\b(?:employees?|cardholders?|people|staff)\b', question, re.I)
                                 and re.search(r'\b(?:total|annual|during|spent|spending)\b', question, re.I)
                                 and re.search(r'\$?50,?000\b', question))
        if annual_employee_query:
            obj.update(intent='group', field='none', keyword='', group_by='FullName',
                       min_amount=None, max_amount=None, group_min_total=50000.0,
                       group_min_exclusive=bool(re.search(r'\b(?:more than|over|exceed(?:ed|s|ing)?|above|greater than)\b', question, re.I)),
                       sort='total_desc', limit=100)
        else:
            obj['group_min_total'] = None
            obj['group_min_exclusive'] = False
        return jsonify(obj)
    except Exception as exc:
        app.logger.warning('Gemini request failed: %s', type(exc).__name__)
        return jsonify(error='Gemini could not interpret this question. Check your API key, quota, and internet connection.'), 502

@app.get('/')
def homepage():
    return send_from_directory(ROOT, 'index.html')

@app.get('/app.js')
@app.get('/styles.css')
def public_asset():
    return send_from_directory(ROOT, request.path.lstrip('/'))

@app.get('/data/<filename>')
def yearly_data(filename):
    if filename not in {f'{year}.js' for year in range(2010, 2015)}:
        return jsonify(error='Not found'), 404
    return send_from_directory(ROOT / 'data', filename)


if __name__ == '__main__':
    if not os.getenv('GEMINI_API_KEY'):
        raise SystemExit('GEMINI_API_KEY is missing from .env')
    app.run(host='127.0.0.1', port=5000, debug=False)
