// Disposable E2E fixture: the counters exist only to prove enforcement order.
// This is not a deployable application or a replacement for an interceptor.
import { createServer } from 'node:http';

let authorizationCalls = 0;
let businessCalls = 0;
const reply = (res, status, body) => {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
	if (req.url === '/_healthcheck') return reply(res, 200, { ready: true });
	if (req.url === '/calls') return reply(res, 200, { authorizationCalls, businessCalls });
	if (req.method !== 'GET' || req.url !== '/projects/1') return reply(res, 404, {});
	try {
		authorizationCalls++;
		const response = await fetch(`${process.env.VERIFIER_URL}/verify`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
			},
			body: JSON.stringify({ resource: 'project:1', action: 'read' }),
			signal: AbortSignal.timeout(5000),
		});
		const decision = await response.json();
		if (response.status !== 200 || decision.decision !== 'allow') {
			return reply(res, response.status === 401 ? 401 : response.status === 403 ? 403 : 503, { rejected: true });
		}
		// Only the business handler changes this counter.
		businessCalls++;
		return reply(res, 200, { project: 1, subject: decision.subject });
	} catch {
		return reply(res, 503, { rejected: true });
	}
}).listen(3000, '0.0.0.0');
