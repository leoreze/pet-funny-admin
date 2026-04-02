function ok(res, payload = {}, status = 200) {
  return res.status(status).json({ ok: true, ...payload });
}

function fail(res, message, status = 400, extra = {}) {
  return res.status(status).json({ ok: false, error: message, ...extra });
}

module.exports = { ok, fail };
