"""Local browser-test fixture only. Never proxy requests to a real tracker.

Run in an isolated Docker network, without a published port. Data is in-memory
and synthetic. This is not a production demo mode or a Keitaro implementation.
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

campaigns = {}
streams = {}
requests = []
offers = [
    dict(id=i, name=f"{i} Example Offer {name}", country=["AU"], state="active",
         payout_value=0, payout_currency="USD")
    for i, name in [(101, "Alpha"), (102, "Beta"), (103, "Gamma")]
]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def handle_request(self):
        from urllib.parse import parse_qs, urlsplit
        url = urlsplit(self.path)
        parts = url.path.removeprefix("/admin_api/v1/").split("/")
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        requests.append(dict(method=self.command, path=url.path, body=body))
        resource = parts[0]
        ident = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
        if self.command == "GET":
            if url.path == "/_test/requests":
                return self.respond(requests)
            if resource == "offers":
                return self.respond(next((o for o in offers if o["id"] == ident), {}) if ident else offers)
            if resource in {"domains", "groups", "traffic_sources"}:
                item = {"domains": (1813, "example.test"), "groups": (10332, "Demo campaigns"), "traffic_sources": (836, "Demo source")}[resource]
                return self.respond([dict(id=item[0], name=item[1])])
            if resource == "campaigns":
                if len(parts) == 3 and parts[2] == "streams":
                    return self.respond([s for s in streams.values() if s["campaign_id"] == ident])
                if ident:
                    return self.respond(campaigns.get(ident, {}), 200 if ident in campaigns else 404)
                q = parse_qs(url.query)
                start, limit = int(q.get("offset", [0])[0]), int(q.get("limit", [100])[0])
                return self.respond(list(campaigns.values())[start:start + limit])
            if resource == "streams":
                return self.respond(streams.get(ident, {}), 200 if ident in streams else 404)
        if self.command == "POST" and resource == "campaigns":
            ident = max(campaigns, default=1000) + 1
            campaigns[ident] = dict(body, id=ident, state="active", alias=f"demo-{ident}")
            return self.respond(campaigns[ident], 201)
        if self.command == "POST" and resource == "streams":
            ident = max(streams, default=2000) + 1
            position = 1 + sum(s["campaign_id"] == body["campaign_id"] for s in streams.values())
            streams[ident] = dict(body, id=ident, position=position)
            return self.respond(streams[ident], 201)
        if self.command == "PUT" and resource == "streams" and ident in streams:
            assert set(body) == {"offers"}, "Only offers may be updated"
            streams[ident].update(body)
            return self.respond(streams[ident])
        if self.command == "DELETE" and resource == "campaigns" and ident in campaigns:
            del campaigns[ident]
            for key in [k for k, s in streams.items() if s["campaign_id"] == ident]:
                del streams[key]
            return self.respond({}, 204)
        self.respond({"detail": "Not found"}, 404)

    do_GET = handle_request
    do_POST = handle_request
    do_PUT = handle_request
    do_DELETE = handle_request


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8081), Handler).serve_forever()
