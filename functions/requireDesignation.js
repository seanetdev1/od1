// req.user is populated by functions/tokenVerification.js (the global auth
// middleware) from the JWT payload, which already carries `designation`.
module.exports = (allowed) => (req, res, next) => {
    const allowedLower = allowed.map((a) => a.toLowerCase());
    if (!req.user || !allowedLower.includes((req.user.designation || '').toLowerCase())) {
        return res.status(403).json({
            status: 'error',
            result: `This action requires designation: ${allowed.join(' or ')}.`,
        });
    }
    next();
};

/**
 * The same question asked INSIDE a handler rather than in front of it.
 *
 * For a route that is open to everyone but where one PART of the request is
 * privileged - editing an account the chart has flagged as not editable, say,
 * on an endpoint every user may otherwise call. Middleware cannot express
 * that: it has to refuse the whole route or none of it.
 *
 * Same source, same comparison, so the two cannot come to different answers
 * about the same user.
 */
module.exports.hasDesignation = (req, allowed) => {
    const allowedLower = allowed.map((a) => a.toLowerCase());
    return Boolean(req.user) && allowedLower.includes((req.user.designation || '').toLowerCase());
};
