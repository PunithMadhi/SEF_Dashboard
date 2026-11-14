// Runs one doGet/doPost call of Code.gs. Usage (from mock_server.py):
//   jsc fake-apps-script.js ../apps-script/Code.gs run-code-gs.js -- <request.json>
// request.json: { state, method: "GET"|"POST", parameter: {...}, body: "..." }
// Prints { state, output: { content, mime } } as JSON.
var __reqFile = arguments[0]; // jsc script arguments (after --)
(function () {
  var req = JSON.parse(readFile(__reqFile));
  __state = req.state || { sheets: {}, cache: {} };
  var out = req.method === 'POST'
    ? doPost({ parameter: req.parameter || {}, postData: { contents: req.body || '', type: 'text/plain' } })
    : doGet({ parameter: req.parameter || {} });
  print(JSON.stringify({ state: __state, output: { content: out.content, mime: out.mime } }));
})();
