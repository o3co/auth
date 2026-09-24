// Disposable E2E fixture: the upstream behind the auth.proxy services that
// forward to it (tests/docker-compose.yml). It answers every request with the
// headers the proxy forwarded, so a suite can assert on exactly what reached
// the upstream — the injected Bearer, or its absence — rather than inferring
// it from whatever an application upstream happened to do with it. It
// verifies nothing: a real upstream must still verify every token it is
// handed (auth.proxy README, "Inbound Authorization headers").
import { createServer } from 'node:http';

createServer((req, res) => {
	res.writeHead(200, { 'content-type': 'application/json' });
	if (req.url === '/_healthcheck') return res.end(JSON.stringify({ ready: true }));
	res.end(
		JSON.stringify({
			method: req.method,
			url: req.url,
			// `null`, not absent, so a missing header is an explicit assertion.
			authorization: req.headers.authorization ?? null,
			cookie: req.headers.cookie ?? null,
		}),
	);
}).listen(3000, '0.0.0.0');
