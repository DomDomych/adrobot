"""Read-only smoke against a running stack; never calls Keitaro."""
import json
import sys
from urllib.error import HTTPError
from urllib.request import ProxyHandler, build_opener

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080"
http = build_opener(ProxyHandler({}))
for path in ("/api/v1/health", "/api/v1/ready"):
    with http.open(base + path, timeout=10) as response:
        assert response.status == 200 and "status" in json.load(response)
        print(path, "OK")
with http.open(base + "/campaigns/123", timeout=10) as response:
    assert b'<div id="root">' in response.read()
    print("SPA deep link OK")
try:
    http.open(base + "/api/v1/not-a-route", timeout=10)
    raise AssertionError("Expected API 404")
except HTTPError as error:
    assert error.code == 404
    assert error.headers.get_content_type() == "application/json"
    print("API 404 remains JSON")
