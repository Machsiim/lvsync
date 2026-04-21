import http.server
import os

PORT = 8081
DIR = os.path.join(os.path.dirname(__file__), "lvsync.Client")

os.chdir(DIR)
httpd = http.server.HTTPServer(("", PORT), http.server.SimpleHTTPRequestHandler)
print(f"Frontend läuft auf http://localhost:{PORT}")
httpd.serve_forever()
