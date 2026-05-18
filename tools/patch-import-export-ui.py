#!/usr/bin/env python3
from pathlib import Path

D = "d" + "iv"
O = "o" + "tion"  # bad word to avoid in tags - only use D

def open_tag(attrs=""):
    return "<" + D + ((" " + attrs) if attrs else "") + ">"

def close_tag():
    return "</" + D + ">"

def build_import_modal():
    L = []
    a = L.append
    a('  <' + D + ' id="importTestModal" class="mt-modal-overlay hidden" aria-hidden="true">')
    a('    <' + D + ' class="mt-modal-panel" style="max-width: 44rem; width: calc(100% - 2rem)">')
    a('      <' + D + ' class="mt-modal-handle">')
    a('        <' + D + '>')
    a('          <h4 class="mt-section-h3" style="margin: 0">Import test</h4>')
    a('          <p class="hint-edit" style="margin: 0.35rem 0 0">')
    a('            Paste or upload a <code>.master-test.json</code> export, or master test results text (<code>Step 1:</code> …).')
    a('          </' + D + '>')
    a('        </' + D + '>')
    a('        <button type="button" class="mt-modal-close" id="importTestModalClose">Cancel</button>')
    a('      </' + D + '>')
    a('      <label for="importTestTextarea" class="hint-edit" style="display: block; margin: 0.75rem 0 0.35rem">Paste export file</label>')
    a('      <textarea id="importTestTextarea" rows="12" spellcheck="false" style="width:100%;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:0.78rem;padding:0.65rem;border-radius:8px;border:1px solid var(--border);background:rgba(0,0,0,0.2);color:var(--text);resize:vertical"></textarea>')
    a('      <' + D + ' style="margin:0.75rem 0">')
    a('        <label for="importTestFile" class="hint-edit">Or upload file</label>')
    a('        <input id="importTestFile" type="file" accept=".json,.master-test.json,.txt,application/json,text/plain" style="display:block;margin-top:0.35rem;width:100%" />')
    a('      </' + D + '>')
    a('      <' + D + ' style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.75rem">')
    a('        <button type="button" id="importTestApply" style="background:rgba(61,156,249,0.25);border:1px solid var(--accent);color:var(--text);border-radius:8px;padding:0.45rem 0.9rem;cursor:pointer">Import test</button>')
    a('      </' + D + '>')
    a('    </' + D + '>')
    a('  </' + D + '>')
    return "\n".join(L)

def build_create_modal():
    L = []
    a = L.append
    a('  <' + D + ' id="createTestModal" class="mt-modal-overlay hidden" aria-hidden="true">')
    a('    <' + D + ' class="mt-modal-panel" style="max-width: 42rem; width: calc(100% - 2rem)">')
    a('      <' + D + ' class="mt-modal-handle">')
    a('        <' + D + '>')
    a('          <h4 id="createTestModalTitle" class="mt-section-h3" style="margin: 0">Create new test</h4>')
    a('          <p id="createTestModalSubtitle" class="hint-edit" style="margin: 0.35rem 0 0">Define steps, data capture, and customer. The test runs automatically when you create it.</p>')
    a('        </' + D + '>')
    a('        <button type="button" class="mt-modal-close" id="createTestModalClose">Cancel</button>')
    a('      </' + D + '>')
    a('      <' + D + ' class="create-test-field">')
    a('        <label for="createTestName">Test name</label>')
    a('        <input type="text" id="createTestName" placeholder="Test 2" autocomplete="off" />')
    a('      </' + D + '>')
    a('      <' + D + ' class="create-test-field" style="display: flex; gap: 0.75rem; flex-wrap: wrap">')
    a('        <' + D + ' style="flex: 1 1 12rem">')
    a('          <label for="createTestCustomerName">Customer name</label>')
    a('          <input type="text" id="createTestCustomerName" value="Susan Young" autocomplete="off" />')
    a('        </' + D + '>')
    a('        <' + D + ' style="flex: 1 1 10rem">')
    a('          <label for="createTestCustomerId">Customer ID</label>')
    a('          <input type="text" id="createTestCustomerId" value="CUS-3011000" autocomplete="off" />')
    a('        </' + D + '>')
    a('      </' + D + '>')
    a('      <' + D + ' id="createTestStepsHost"></' + D + '>')
    a('      <' + D + ' class="create-test-actions-row">')
    a('        <button type="button" id="createTestAddStep">+ Add step</button>')
    a('      </' + D + '>')
    a('      <' + D + ' class="create-test-footer-stack">')
    a('        <button type="button" id="btnImportTest" class="import-test-btn">Import Test</button>')
    a('        <' + D + ' style="display: flex; justify-content: flex-end; gap: 0.5rem">')
    a('          <button type="button" id="createTestSubmit" style="background: rgba(61, 156, 249, 0.25); border: 1px solid var(--accent); color: var(--text); border-radius: 8px; padding: 0.45rem 0.9rem; cursor: pointer">Create Test</button>')
    a('        </' + D + '>')
    a('      </' + D + '>')
    a('    </' + D + '>')
    a('  </' + D + '>')
    return "\n".join(L)

p = Path(__file__).resolve().parent.parent / "Test Scripts" / "master_test_viewer.html"
text = p.read_text()
bad = "  <m" + O + ">"
idx = text.find(bad)
if idx < 0:
    raise SystemExit("broken tag not found at line ~924")
end_marker = '  <div id="mtClipboardToast"'
end = text.find(end_marker)
if end < 0:
    raise SystemExit("end marker not found")
new_block = build_import_modal() + "\n\n" + build_create_modal() + "\n\n"
text = text[:idx] + new_block + text[end:]
p.write_text(text)
print("Patched HTML modals OK")
