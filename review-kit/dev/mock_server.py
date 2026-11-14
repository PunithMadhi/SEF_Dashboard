#!/usr/bin/env python3
"""Local stand-in for the deployed Apps Script web app.

Runs the real review-kit/apps-script/Code.gs in macOS JavaScriptCore (jsc) against an
in-memory fake sheet, so the kit can be tested without Google.

    python3 review-kit/dev/mock_server.py          # serves http://localhost:8787/exec
    python3 review-kit/dev/mock_server.py --reset  # start with an empty sheet

The fake sheet lives in review-kit/dev/.mock-sheet.json (git-ignored). Open
http://localhost:8787/sheet to see the Log and Review tabs as JSON.
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
CODE_GS = os.path.join(HERE, '..', 'apps-script', 'Code.gs')
STATE_FILE = os.path.join(HERE, '.mock-sheet.json')
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
PORT = int(os.environ.get('PORT', '8787'))
LOCK = threading.Lock()


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {'sheets': {}, 'cache': {}}


def run(method, parameter, body=''):
    with LOCK:
        req = {'state': load_state(), 'method': method, 'parameter': parameter, 'body': body}
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as tmp:
            json.dump(req, tmp)
        try:
            out = subprocess.run(
                [JSC, os.path.join(HERE, 'fake-apps-script.js'), CODE_GS, os.path.join(HERE, 'run-code-gs.js'), '--', tmp.name],
                capture_output=True, text=True, timeout=20)
        finally:
            os.unlink(tmp.name)
        if out.returncode != 0 or not out.stdout.strip():
            raise RuntimeError(out.stderr or out.stdout or 'jsc failed')
        res = json.loads(out.stdout.strip().splitlines()[-1])
        with open(STATE_FILE, 'w') as f:
            json.dump(res['state'], f)
        return res['output']


class Handler(BaseHTTPRequestHandler):
    def send(self, code, content, mime):
        data = content.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', mime + '; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/sheet':
            return self.send(200, json.dumps(load_state()['sheets'], indent=2), 'application/json')
        if url.path != '/exec':
            return self.send(404, 'Not found', 'text/plain')
        params = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            out = run('GET', params)
            self.send(200, out['content'], out['mime'])
        except Exception as e:  # noqa: BLE001 - surface any failure to the caller
            self.send(500, str(e), 'text/plain')

    def do_POST(self):
        if urlparse(self.path).path != '/exec':
            return self.send(404, 'Not found', 'text/plain')
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0)).decode('utf-8')
        try:
            out = run('POST', {}, body)
            self.send(200, out['content'], out['mime'])
        except Exception as e:  # noqa: BLE001
            self.send(500, str(e), 'text/plain')

    def log_message(self, fmt, *args):
        sys.stderr.write('mock: ' + fmt % args + '\n')


if __name__ == '__main__':
    if '--reset' in sys.argv and os.path.exists(STATE_FILE):
        os.remove(STATE_FILE)
    print(f'Review kit mock endpoint: http://localhost:{PORT}/exec  (sheet: http://localhost:{PORT}/sheet)')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
