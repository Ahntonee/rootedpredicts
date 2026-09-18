/* Site Pages uses the same Quill Snow editor and toolbar as Blog Posts. */
'use strict';
class PageEditor {
  constructor(textarea, onChange) {
    this.source = textarea;
    this.onChange = onChange;
    this.container = document.createElement('div');
    textarea.before(this.container);
    this.quill = new Quill(this.container, {
      theme: 'snow',
      placeholder: 'Write article content here...',
      modules: { toolbar: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        ['blockquote', 'code-block'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['link', 'image'],
        ['clean'],
      ] },
    });
    this.visual = this.quill.root;
    this.toolbar = this.quill.getModule('toolbar').container;
    this.toggle = document.createElement('button');
    this.toggle.type = 'button'; this.toggle.className = 'btn btn-outline btn-sm editor-source-toggle';
    this.toggle.textContent = 'HTML source';
    this.container.after(this.toggle);
    this.toggle.onclick = () => this.toggleSource();
    textarea.hidden = true;
    this.quill.on('text-change', (delta, old, source) => {
      if (source === 'silent') return;
      this.source.value = this.visual.innerHTML === '<p><br></p>' ? '' : this.visual.innerHTML;
      this.onChange();
    });
    textarea.addEventListener('input', () => this.onChange());
  }
  setContent(html) {
    this.source.value = html || '';
    this.quill.clipboard.dangerouslyPasteHTML(html || '', 'silent');
    this.quill.history.clear();
    this.source.hidden = true;
    this.container.hidden = false;
    this.toolbar.hidden = false;
    this.toggle.textContent = 'HTML source';
  }
  getContent() { return this.source.value; }
  toggleSource() {
    const showSource = this.source.hidden;
    if (!showSource) {
      this.quill.clipboard.dangerouslyPasteHTML(this.source.value, 'silent');
      this.quill.history.clear();
    }
    this.source.hidden = !showSource;
    this.container.hidden = showSource;
    this.toolbar.hidden = showSource;
    this.toggle.textContent = showSource ? 'Visual editor' : 'HTML source';
  }
}
