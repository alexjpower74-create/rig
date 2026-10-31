// Imported first by every test that can reach a terminal backend. Run from a terminal in the Herdr
// app, the suite inherits HC_TERMINAL_ID, and `auto` would pick the hc backend and drive the person's
// real window and agents. A test that wants hc sets these itself, with a fake hc on PATH.
for (const k of ['HC_TERMINAL_ID', 'HC_TERMINAL_SOCKET', 'HC_SESSION']) delete process.env[k]
