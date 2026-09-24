// Disposable E2E fixture: the upstream behind the auth.proxy services that
// forward to it (tests/docker-compose.yml). It answers every request with the
// headers the proxy forwarded, so a suite can assert on exactly what reached
// the upstream — the injected Bearer, or its absence — rather than inferring
// it from whatever an application upstream happened to do with it. It
// verifies nothing: a real upstream must still verify every token it is
// handed (auth.proxy README, "Inbound Authorization headers").
//
// Headers are reported through `headersDistinct`, as arrays of every value
// received: `req.headers` keeps only the first of repeated `authorization`
// headers and discards the rest, which would hide a proxy that forwarded the
// client's header beside the one it injected.
//
// A request carrying `x-e2e-probe: <id>` is remembered, and `GET /_seen/<id>`
// answers whether it arrived, so a suite can observe — not infer — that a
// refused request never reached the upstream. The probe is per request, so
// suites running in parallel against this one upstream cannot see each other's.
import { createServer } from 'node:http';

const seen = new Set();

createServer((req, res) => {
	res.writeHead(200, { 'content-type': 'application/json' });
	if (req.url === '/_healthcheck') return res.end(JSON.stringify({ ready: true }));
	const asked = /^\/_seen\/([\w-]+)$/.exec(req.url ?? '');
	if (asked) return res.end(JSON.stringify({ seen: seen.has(asked[1]) }));
	const probe = req.headersDistinct['x-e2e-probe']?.[0];
	if (probe !== undefined) seen.add(probe);
	res.end(
		JSON.stringify({
			method: req.method,
			url: req.url,
			// `null`, not absent, so a missing header is an explicit assertion.
			authorization: req.headersDistinct.authorization ?? null,
			cookie: req.headersDistinct.cookie ?? null,
		}),
	);
}).listen(3000, '0.0.0.0');
