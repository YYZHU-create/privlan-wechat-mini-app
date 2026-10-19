// Run auditInspectorLayout(document) in the rendered editor; returns geometry only.
function auditInspectorLayout(doc) {
  const failures = [];
  const panel = doc.querySelector('.side-panel.right');
  if (!panel) return { status: 'NOT_VERIFIED', failures: ['PANEL_MISSING'] };
  const bounds = panel.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return { status: 'NOT_VERIFIED', failures: ['PANEL_NOT_VISIBLE'] };
  for (const node of panel.querySelectorAll('.field-title, input:not([type="hidden"]), select, textarea, .choice-grid button')) {
    const rect = node.getBoundingClientRect();
    if (!node.getClientRects().length) continue;
    const label = node.getAttribute('aria-label') || node.textContent.trim().slice(0, 32) || node.tagName;
    if (rect.width < 16) failures.push({ label, code: 'CONTROL_TOO_NARROW', width: rect.width });
    if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) failures.push({ label, code: 'PANEL_OVERFLOW' });
    if (node.classList.contains('field-title') && rect.height > 48) failures.push({ label, code: 'TITLE_WRAP_EXCESSIVE' });
  }
  return { status: failures.length ? 'FAIL' : 'PASS', failures };
}
if (typeof module !== 'undefined') module.exports = { auditInspectorLayout };
