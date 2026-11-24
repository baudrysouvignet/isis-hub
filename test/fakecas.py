# Faux CAS de test : /cas/serviceValidate accepte tout ticket « ST-<identifiant>-<n'importe quoi> ».
import http.server, urllib.parse, re
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        t = q.get('ticket', [''])[0]
        m = re.match(r'^ST-([a-z0-9]+)-', t)
        if u.path == '/cas/serviceValidate' and m:
            body = f'<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>{m.group(1)}</cas:user></cas:authenticationSuccess></cas:serviceResponse>'
        else:
            body = '<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationFailure code="INVALID_TICKET">non</cas:authenticationFailure></cas:serviceResponse>'
        b = body.encode()
        self.send_response(200); self.send_header('Content-Type', 'application/xml'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', 8098), H).serve_forever()
