/* Visual HTML editor shared by the Site Pages dashboard. */
'use strict';
class PageEditor {
  constructor(textarea, onChange) {
    this.source = textarea;
    this.onChange = onChange;
    this.range = null;
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'page-editor-toolbar';
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', 'Text formatting');
    this.visual = document.createElement('div');
    this.visual.className = 'page-editor-visual';
    this.visual.contentEditable = 'true';
    this.visual.setAttribute('role', 'textbox');
    this.visual.setAttribute('aria-label', 'Page article');
    this.visual.setAttribute('aria-multiline', 'true');
    textarea.before(this.toolbar, this.visual);
    textarea.hidden = true;
    const heading = document.createElement('select');
    heading.setAttribute('aria-label', 'Paragraph or heading');
    for (const [value, label] of [['p','Paragraph'], ['h1','Heading 1'], ['h2','Heading 2'], ['h3','Heading 3'], ['h4','Heading 4'], ['blockquote','Quote']]) {
      const option = document.createElement('option');
      option.value = value; option.textContent = label; heading.append(option);
    }
    heading.onchange = () => { this.command('formatBlock', heading.value); heading.value = 'p'; };
    this.toolbar.append(heading);
    for (const [label, command] of [['Bold','bold'], ['Italic','italic'], ['Underline','underline'], ['Bullets','insertUnorderedList'], ['Numbered list','insertOrderedList'], ['Link','createLink'], ['Unlink','unlink'], ['Clear format','removeFormat'], ['Undo','undo'], ['Redo','redo']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label;
      button.onmousedown = event => event.preventDefault();
      button.onclick = () => {
        let value;
        if (command === 'createLink') {
          value = window.prompt('Link URL (https://, mailto:, /page, or #section)');
          if (!value) return;
          value = value.trim();
          if (!/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(value)) {
            window.alert('Enter a valid website, email or page link.'); return;
          }
        }
        this.command(command, value);
      };
      this.toolbar.append(button);
    }
    this.toggle = document.createElement('button');
    this.toggle.type = 'button'; this.toggle.textContent = 'HTML source';
    this.toggle.onclick = () => this.toggleSource();
    this.toolbar.append(this.toggle);
    this.visual.addEventListener('input', () => { this.sync(); this.onChange(); });
    textarea.addEventListener('input', () => this.onChange());
    document.addEventListener('selectionchange', () => {
      const selection = window.getSelection();
      if (selection.rangeCount && this.visual.contains(selection.anchorNode) && this.visual.contains(selection.focusNode)) {
        this.range = selection.getRangeAt(0).cloneRange();
      }
    });
  }
  command(command, value) {
    this.visual.focus();
    if (this.range) {
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(this.range);
    }
    document.execCommand(command, false, value);
    this.sync(); this.onChange();
  }
  sync() {
    this.source.value = this.visual.innerHTML;
  }
  setContent(html) {
    this.source.value = html || '';
    this.visual.innerHTML = html || '';
    this.range = null;
    this.source.hidden = true; this.visual.hidden = false;
    this.toggle.textContent = 'HTML source';
    this.toolbar.querySelectorAll('button, select').forEach(el => el.disabled = false);
  }
  getContent() { return this.source.value; }
  toggleSource() {
    const showSource = this.source.hidden;
    if (!showSource) { this.visual.innerHTML = this.source.value; this.range = null; }
    this.source.hidden = !showSource; this.visual.hidden = showSource;
    this.toggle.textContent = showSource ? 'Visual editor' : 'HTML source';
    this.toolbar.querySelectorAll('button, select').forEach(el => el.disabled = showSource && el !== this.toggle);
  }
}
