(() => {
  'use strict';

  const OWNER = 'JonahBalfour';
  const REPO = 'Jonah-balfour-portfolio';
  const BRANCH = 'main';
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const TOKEN_KEY = 'gh_pat';
  const MAX_FILE_BYTES = 1000000; // Contents API cap for this endpoint

  const $ = (id) => document.getElementById(id);

  const authGateEl = $('authGate');
  const appEl = $('app');
  const tokenInputEl = $('tokenInput');
  const connectBtnEl = $('connectBtn');
  const authStatusEl = $('authStatus');
  const authErrorEl = $('authError');
  const signOutBtnEl = $('signOutBtn');

  const editorViewEl = $('editorView');
  const manageViewEl = $('manageView');
  const editorHeadingEl = $('editorHeading');

  const titleInputEl = $('titleInput');
  const slugDisplayEl = $('slugDisplay');
  const slugInputEl = $('slugInput');
  const editSlugBtnEl = $('editSlugBtn');
  const dateInputEl = $('dateInput');
  const tagInputEl = $('tagInput');
  const summaryInputEl = $('summaryInput');
  const editorEl = $('editor');
  const imageBtnEl = $('imageBtn');
  const imageFileEl = $('imageFile');
  const linkBtnEl = $('linkBtn');
  const publishBtnEl = $('publishBtn');
  const cancelEditBtnEl = $('cancelEditBtn');
  const statusLogEl = $('statusLog');
  const postsListEl = $('postsList');

  const state = {
    mode: 'new', // 'new' | 'edit'
    editingSlug: null,
    editingPostSha: null,
    uploadCounter: 0,
  };

  let slugOverride = false;
  let pendingImageRange = null;

  // ---------- base64 (UTF-8 safe) ----------

  function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function fromBase64(b64) {
    const binary = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- GitHub API ----------

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  async function ghFetch(path, options = {}) {
    return fetch(`${API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        Accept: 'application/vnd.github+json',
        ...(options.headers || {}),
      },
    });
  }

  async function apiError(res) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j.message || '';
    } catch (e) { /* ignore */ }
    const err = new Error(detail || `GitHub API error (${res.status})`);
    err.status = res.status;
    err.rateLimitRemaining = res.headers.get('x-ratelimit-remaining');
    err.rateLimitReset = res.headers.get('x-ratelimit-reset');
    return err;
  }

  async function getFile(filePath) {
    const res = await ghFetch(`/contents/${filePath}?ref=${BRANCH}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await apiError(res);
    const data = await res.json();
    return { sha: data.sha, content: fromBase64(data.content) };
  }

  async function putFile(filePath, contentStr, message, sha) {
    const body = { message, content: toBase64(contentStr), branch: BRANCH };
    if (sha) body.sha = sha;
    const res = await ghFetch(`/contents/${filePath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  }

  async function putMediaFile(filePath, base64Content, message) {
    const body = { message, content: base64Content, branch: BRANCH };
    const res = await ghFetch(`/contents/${filePath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  }

  async function deleteFile(filePath, message, sha) {
    const res = await ghFetch(`/contents/${filePath}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sha, branch: BRANCH }),
    });
    if (!res.ok) throw await apiError(res);
    return res.json();
  }

  async function validateToken(token) {
    try {
      const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
      if (res.status === 200) return { ok: true };
      if (res.status === 401) return { ok: false, reason: 'invalid' };
      if (res.status === 403 || res.status === 404) return { ok: false, reason: 'forbidden' };
      return { ok: false, reason: 'network' };
    } catch (e) {
      return { ok: false, reason: 'network' };
    }
  }

  function describeError(err, action) {
    if (err.status === 401) return `Your token appears invalid or expired while ${action}. Sign out and reconnect with a fresh token.`;
    if (err.status === 409) return `Something else changed this file while ${action}. Reload the page and try again.`;
    if (err.status === 403 && err.rateLimitRemaining === '0') {
      const reset = err.rateLimitReset ? new Date(Number(err.rateLimitReset) * 1000).toLocaleTimeString() : 'shortly';
      return `GitHub API rate limit hit while ${action}. Try again after ${reset}.`;
    }
    if (err.status === 403 || err.status === 404) return `Permission problem while ${action} — check your token has Contents read/write access to this repo.`;
    return `Error while ${action}: ${err.message}`;
  }

  // ---------- slug / date helpers ----------

  function slugify(title) {
    return String(title)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function formatDateText(isoDate) {
    const d = new Date(`${isoDate}T00:00:00`);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function parseDateTextToInput(dateText) {
    const d = new Date(dateText);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function currentSlug() {
    return slugOverride ? slugify(slugInputEl.value) : slugify(titleInputEl.value);
  }

  function updateSlugDisplay() {
    const s = slugify(titleInputEl.value);
    slugDisplayEl.textContent = s || '(enter a title)';
    if (!slugOverride) slugInputEl.value = s;
  }

  // ---------- sanitizer ----------

  const ALLOWED_TAGS = new Set(['P', 'H2', 'H3', 'A', 'STRONG', 'B', 'EM', 'I', 'BLOCKQUOTE', 'IMG', 'BR']);
  const ALLOWED_ATTRS = { A: ['href'], IMG: ['src', 'alt'] };

  function sanitizeHtml(html) {
    const container = document.createElement('div');
    container.innerHTML = html;

    function clean(node) {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          clean(child);
          if (!ALLOWED_TAGS.has(child.tagName)) {
            while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
            child.parentNode.removeChild(child);
          } else {
            const allowed = ALLOWED_ATTRS[child.tagName] || [];
            [...child.attributes].forEach((attr) => {
              if (!allowed.includes(attr.name)) child.removeAttribute(attr.name);
            });
          }
        } else if (child.nodeType !== Node.TEXT_NODE) {
          child.parentNode.removeChild(child);
        }
      });
    }

    clean(container);
    return container.innerHTML.trim();
  }

  // ---------- templates ----------

  function buildPostHtml({ title, tag, dateText, bodyHtml }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#16223e">
<title>${escapeHtml(title)} — Jonah Balfour</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../style.css">
</head>
<body>

<header class="site">
  <div class="wrap">
    <a class="name" href="../../index.html">Jonah Balfour</a>
    <nav class="site">
      <a href="../../index.html#writing">Writing</a>
      <a href="../index.html" class="current">Blog</a>
      <a href="../../projects/index.html">Claude Projects</a>
      <a href="../../index.html#contact">Contact</a>
    </nav>
  </div>
</header>

<div class="wrap">
  <div class="post-header" style="padding-top: 48px;">
    <a class="back-link" href="../index.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 7L7 17M7 17H17M7 17V7"/></svg> Back to Blog</a>
    <div class="sample-meta">
      <span class="tag">${escapeHtml(tag)}</span>
      <span class="pub">${escapeHtml(dateText)}</span>
    </div>
    <h1 class="post-title">${escapeHtml(title)}</h1>
  </div>

  <article class="post-content">
    ${bodyHtml}
  </article>
</div>

<footer class="contact" id="contact">
  <div class="wrap">
    <h2 class="section-title">Contact</h2>
    <p>Open to new opportunities in marketing content, communications, and PR — guides, blog posts, case studies, and press releases for tech companies and startups.</p>
    <a class="contact-email" href="mailto:jcbalfour1980@gmail.com">jcbalfour1980@gmail.com</a>
    <div class="contact-links">
      <a class="contact-link" href="tel:+972546175584">054-617-5584</a>
      <span class="contact-sep">·</span>
      <a class="contact-link" href="../../jonah-balfour-cv.pdf" target="_blank" rel="noopener">Download my CV (PDF)</a>
    </div>
    <div class="fine-print">Jonah Balfour · Site built with Claude</div>
  </div>
</footer>

<script src="../../app.js"></script>
</body>
</html>
`;
  }

  function parsePostPage(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.querySelector('.post-title')?.textContent.trim() || '';
    const tag = doc.querySelector('.post-header .tag')?.textContent.trim() || '';
    const dateText = doc.querySelector('.post-header .pub')?.textContent.trim() || '';
    const bodyHtml = doc.querySelector('article.post-content')?.innerHTML.trim() || '';
    return { title, tag, dateText, bodyHtml };
  }

  function buildArticleNode(doc, { title, tag, dateText, summary, slug }) {
    const article = doc.createElement('article');
    article.className = 'sample';
    article.innerHTML = `
        <div class="sample-body">
          <div class="sample-meta">
            <span class="tag">${escapeHtml(tag)}</span>
            <span class="pub">${escapeHtml(dateText)}</span>
          </div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(summary)}</p>
          <a class="read-link" href="posts/${slug}.html">Read the post <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg></a>
        </div>`;
    return article;
  }

  function updateArticleNode(article, { title, tag, dateText, summary }) {
    article.querySelector('.tag').textContent = tag;
    article.querySelector('.pub').textContent = dateText;
    article.querySelector('h3').textContent = title;
    article.querySelector('p').textContent = summary;
  }

  function listPostsFromDoc(doc) {
    return [...doc.querySelectorAll('.samples-list > article.sample')].map((article) => {
      const tag = article.querySelector('.tag')?.textContent.trim() || '';
      const dateText = article.querySelector('.pub')?.textContent.trim() || '';
      const title = article.querySelector('h3')?.textContent.trim() || '';
      const summary = article.querySelector('p')?.textContent.trim() || '';
      const href = article.querySelector('a.read-link')?.getAttribute('href') || '';
      const slug = href.replace(/^posts\//, '').replace(/\.html$/, '');
      return { tag, dateText, title, summary, href, slug };
    });
  }

  function serializeDoc(doc) {
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}\n`;
  }

  // ---------- status log ----------

  function appendStatus(message, type = 'info', opts = {}) {
    const el = document.createElement('div');
    el.className = `admin-status admin-status-${type}`;
    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);
    if (opts.retry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Retry';
      btn.className = 'admin-btn-secondary admin-status-retry';
      btn.addEventListener('click', () => {
        btn.disabled = true;
        opts.retry();
      });
      el.appendChild(btn);
    }
    statusLogEl.prepend(el);
  }

  function clearStatus() {
    statusLogEl.innerHTML = '';
  }

  // ---------- auth ----------

  function showGate(message) {
    authGateEl.hidden = false;
    appEl.hidden = true;
    if (message) {
      authErrorEl.hidden = false;
      authErrorEl.textContent = message;
    }
  }

  function showApp() {
    authGateEl.hidden = true;
    appEl.hidden = false;
  }

  async function init() {
    const token = getToken();
    if (!token) { showGate(); return; }
    authStatusEl.textContent = 'Checking saved token…';
    const result = await validateToken(token);
    authStatusEl.textContent = '';
    if (result.ok) {
      showApp();
    } else {
      localStorage.removeItem(TOKEN_KEY);
      showGate(
        result.reason === 'invalid'
          ? 'Saved token is no longer valid — reconnect below.'
          : 'Could not verify the saved token — reconnect below.'
      );
    }
  }

  connectBtnEl.addEventListener('click', async () => {
    const token = tokenInputEl.value.trim();
    if (!token) return;
    connectBtnEl.disabled = true;
    authErrorEl.hidden = true;
    authStatusEl.textContent = 'Checking token…';
    const result = await validateToken(token);
    connectBtnEl.disabled = false;
    authStatusEl.textContent = '';
    if (result.ok) {
      localStorage.setItem(TOKEN_KEY, token);
      showApp();
    } else {
      authErrorEl.hidden = false;
      authErrorEl.textContent =
        result.reason === 'invalid'
          ? 'That token was rejected (invalid or expired).'
          : result.reason === 'forbidden'
          ? "That token doesn't have access to this repo — check it's a fine-grained PAT scoped to Jonah-balfour-portfolio with Contents read/write."
          : 'Network error validating the token — check your connection and try again.';
    }
  });

  signOutBtnEl.addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  });

  // ---------- tabs ----------

  function switchTab(name) {
    document.querySelectorAll('.admin-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    editorViewEl.hidden = name !== 'editor';
    manageViewEl.hidden = name !== 'manage';
    if (name === 'manage') loadManageView();
  }

  document.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // ---------- editor toolbar ----------

  titleInputEl.addEventListener('input', () => {
    if (!slugOverride) updateSlugDisplay();
  });

  editSlugBtnEl.addEventListener('click', () => {
    slugOverride = true;
    slugInputEl.value = slugify(slugInputEl.value || slugDisplayEl.textContent);
    slugDisplayEl.hidden = true;
    slugInputEl.hidden = false;
    slugInputEl.focus();
  });

  slugInputEl.addEventListener('blur', () => {
    const s = slugify(slugInputEl.value);
    slugInputEl.value = s;
    slugDisplayEl.textContent = s || '(enter a title)';
  });

  function lockSlug(slug) {
    slugOverride = false;
    slugDisplayEl.hidden = false;
    slugInputEl.hidden = true;
    slugDisplayEl.textContent = slug;
    slugInputEl.value = slug;
    editSlugBtnEl.hidden = true;
  }

  function unlockSlug() {
    editSlugBtnEl.hidden = false;
    slugOverride = false;
    updateSlugDisplay();
  }

  document.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editorEl.focus();
      document.execCommand(btn.dataset.cmd);
    });
  });

  document.querySelectorAll('[data-block]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editorEl.focus();
      document.execCommand('formatBlock', false, `<${btn.dataset.block}>`);
    });
  });

  linkBtnEl.addEventListener('click', () => {
    const url = window.prompt('Link URL:', 'https://');
    if (!url) return;
    editorEl.focus();
    document.execCommand('createLink', false, url);
  });

  function placeCursorAtEnd(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  imageBtnEl.addEventListener('click', () => {
    const sel = window.getSelection();
    if (!sel.rangeCount || !editorEl.contains(sel.anchorNode)) {
      placeCursorAtEnd(editorEl);
    }
    pendingImageRange = window.getSelection().getRangeAt(0).cloneRange();
    imageFileEl.click();
  });

  imageFileEl.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    imageFileEl.value = '';
    if (file) await handleImageUpload(file, pendingImageRange);
  });

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsDataURL(file);
    });
  }

  async function handleImageUpload(file, range) {
    if (file.size > MAX_FILE_BYTES) {
      appendStatus(`"${file.name}" is too large (${Math.round(file.size / 1024)}KB) — GitHub's Contents API caps files at ~1MB. Resize/compress and try again.`, 'error');
      return;
    }
    const alt = window.prompt('Alt text for this image (optional, for accessibility):', '') || '';
    appendStatus(`Uploading ${file.name}…`);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const base64 = dataUrl.split(',')[1];
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const slugBase = currentSlug() || 'post';
      state.uploadCounter += 1;
      const filename = `${slugBase}-${state.uploadCounter}.${ext}`;
      await putMediaFile(`blog/media/${filename}`, base64, `Add media: ${filename}`);

      if (range) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        placeCursorAtEnd(editorEl);
      }
      editorEl.focus();
      document.execCommand('insertImage', false, `../media/${filename}`);
      const img = editorEl.querySelector(`img[src="../media/${filename}"]`);
      if (img) img.alt = alt;

      appendStatus(`Image uploaded: ${filename}`, 'success');
    } catch (err) {
      appendStatus(describeError(err, `uploading "${file.name}"`), 'error');
    }
  }

  // ---------- form reset / load ----------

  function resetToNewPost() {
    state.mode = 'new';
    state.editingSlug = null;
    state.editingPostSha = null;
    state.uploadCounter = 0;
    titleInputEl.value = '';
    tagInputEl.value = '';
    dateInputEl.value = '';
    summaryInputEl.value = '';
    editorEl.innerHTML = '';
    unlockSlug();
    editorHeadingEl.textContent = 'New Post';
    publishBtnEl.textContent = 'Publish';
    cancelEditBtnEl.hidden = true;
    clearStatus();
  }

  cancelEditBtnEl.addEventListener('click', resetToNewPost);

  async function loadPostForEdit(slug) {
    switchTab('editor');
    clearStatus();
    appendStatus('Loading post…');
    try {
      const postFile = await getFile(`blog/posts/${slug}.html`);
      if (!postFile) throw new Error('Post file not found.');
      const parsed = parsePostPage(postFile.content);

      const indexFile = await getFile('blog/index.html');
      const doc = new DOMParser().parseFromString(indexFile.content, 'text/html');
      const match = listPostsFromDoc(doc).find((p) => p.slug === slug);

      state.mode = 'edit';
      state.editingSlug = slug;
      state.editingPostSha = postFile.sha;
      state.uploadCounter = 0;

      titleInputEl.value = parsed.title;
      tagInputEl.value = parsed.tag;
      dateInputEl.value = parseDateTextToInput(parsed.dateText);
      summaryInputEl.value = match ? match.summary : '';
      editorEl.innerHTML = parsed.bodyHtml;
      lockSlug(slug);

      editorHeadingEl.textContent = 'Edit Post';
      publishBtnEl.textContent = 'Save Changes';
      cancelEditBtnEl.hidden = false;
      clearStatus();
    } catch (err) {
      clearStatus();
      appendStatus(describeError(err, 'loading this post'), 'error');
    }
  }

  // ---------- publish / save ----------

  async function updateIndexForPublish(mode, { slug, title, tag, dateText, summary }) {
    const indexFile = await getFile('blog/index.html');
    const doc = new DOMParser().parseFromString(indexFile.content, 'text/html');

    if (mode === 'new') {
      const container = doc.querySelector('.samples-list');
      const article = buildArticleNode(doc, { title, tag, dateText, summary, slug });
      container.prepend(article);
    } else {
      const articles = doc.querySelectorAll('.samples-list > article.sample');
      let target = null;
      articles.forEach((a) => {
        if (a.querySelector('a.read-link')?.getAttribute('href') === `posts/${slug}.html`) target = a;
      });
      if (!target) throw new Error(`Could not find "${slug}" in the blog list to update.`);
      updateArticleNode(target, { title, tag, dateText, summary });
    }

    const html = serializeDoc(doc);
    const message = mode === 'new' ? `Add "${title}" to blog index` : `Update "${title}" in blog index`;
    await putFile('blog/index.html', html, message, indexFile.sha);
  }

  function runIndexUpdate(mode, fields) {
    updateIndexForPublish(mode, fields)
      .then(() => appendStatus('Blog list updated.', 'success'))
      .catch((err) => {
        appendStatus(describeError(err, 'updating the blog list'), 'error', {
          retry: () => runIndexUpdate(mode, fields),
        });
      });
  }

  publishBtnEl.addEventListener('click', async () => {
    clearStatus();
    const title = titleInputEl.value.trim();
    const tag = tagInputEl.value.trim();
    const dateIso = dateInputEl.value;
    const summary = summaryInputEl.value.trim();
    const bodyText = editorEl.textContent.trim();

    if (!title || !tag || !dateIso || !summary || !bodyText) {
      appendStatus('Please fill in title, date, tag, summary, and body before publishing.', 'error');
      return;
    }

    const publishMode = state.mode;
    const slug = publishMode === 'edit' ? state.editingSlug : currentSlug();
    if (!slug) {
      appendStatus('Could not determine a slug from the title.', 'error');
      return;
    }

    const dateText = formatDateText(dateIso);
    const bodyHtml = sanitizeHtml(editorEl.innerHTML);

    publishBtnEl.disabled = true;

    try {
      if (publishMode === 'new') {
        const existing = await getFile(`blog/posts/${slug}.html`);
        if (existing) {
          appendStatus(`A post already exists at this slug ("${slug}"). Change the title or edit the slug and try again.`, 'error');
          publishBtnEl.disabled = false;
          return;
        }
      }

      const postHtml = buildPostHtml({ title, tag, dateText, bodyHtml });
      const message = publishMode === 'new' ? `Add blog post: ${title}` : `Update blog post: ${title}`;
      const saved = await putFile(
        `blog/posts/${slug}.html`,
        postHtml,
        message,
        publishMode === 'edit' ? state.editingPostSha : undefined
      );
      state.editingPostSha = saved.content.sha;
      appendStatus(`Post file ${publishMode === 'new' ? 'created' : 'updated'}.`, 'success');
    } catch (err) {
      appendStatus(describeError(err, 'saving the post file'), 'error');
      publishBtnEl.disabled = false;
      return;
    }

    const indexFields = { slug, title, tag, dateText, summary };
    try {
      await updateIndexForPublish(publishMode, indexFields);
      appendStatus('Blog list updated.', 'success');
      appendStatus(`Live at blog/posts/${slug}.html once GitHub Pages redeploys (usually under a minute).`, 'info');
      if (publishMode === 'new') {
        state.mode = 'edit';
        state.editingSlug = slug;
        editorHeadingEl.textContent = 'Edit Post';
        publishBtnEl.textContent = 'Save Changes';
        cancelEditBtnEl.hidden = false;
        lockSlug(slug);
      }
    } catch (err) {
      appendStatus(describeError(err, 'updating the blog list'), 'error', {
        retry: () => runIndexUpdate(publishMode, indexFields),
      });
    }

    publishBtnEl.disabled = false;
  });

  // ---------- manage view ----------

  async function removeFromIndex(slug) {
    const indexFile = await getFile('blog/index.html');
    const doc = new DOMParser().parseFromString(indexFile.content, 'text/html');
    const articles = doc.querySelectorAll('.samples-list > article.sample');
    let target = null;
    articles.forEach((a) => {
      if (a.querySelector('a.read-link')?.getAttribute('href') === `posts/${slug}.html`) target = a;
    });
    if (target) target.remove();
    const html = serializeDoc(doc);
    await putFile('blog/index.html', html, `Remove blog post from index: ${slug}`, indexFile.sha);
  }

  async function loadManageView() {
    postsListEl.innerHTML = 'Loading…';
    try {
      const indexFile = await getFile('blog/index.html');
      const doc = new DOMParser().parseFromString(indexFile.content, 'text/html');
      const posts = listPostsFromDoc(doc);
      if (!posts.length) {
        postsListEl.innerHTML = '<p class="admin-hint">No posts yet.</p>';
        return;
      }
      postsListEl.innerHTML = '';
      posts.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'admin-post-row';
        row.innerHTML = `
          <div class="admin-post-row-main">
            <strong>${escapeHtml(p.title)}</strong>
            <span class="admin-post-row-meta">${escapeHtml(p.tag)} · ${escapeHtml(p.dateText)}</span>
          </div>
          <div class="admin-post-row-actions">
            <button type="button" class="admin-btn-secondary" data-action="edit" data-slug="${escapeHtml(p.slug)}">Edit</button>
            <button type="button" class="admin-btn-danger" data-action="delete" data-slug="${escapeHtml(p.slug)}">Delete</button>
          </div>`;
        postsListEl.appendChild(row);
      });
    } catch (err) {
      postsListEl.innerHTML = `<p class="admin-status admin-status-error">${escapeHtml(describeError(err, 'loading posts'))}</p>`;
    }
  }

  postsListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const slug = btn.dataset.slug;
    if (btn.dataset.action === 'edit') {
      loadPostForEdit(slug);
    } else if (btn.dataset.action === 'delete') {
      confirmAndDelete(slug);
    }
  });

  async function confirmAndDelete(slug) {
    const ok = window.confirm(
      'Delete this post? It will be removed from the site immediately once GitHub Pages redeploys. Any uploaded images stay in blog/media/ (not auto-deleted).'
    );
    if (!ok) return;
    postsListEl.innerHTML = 'Deleting…';
    try {
      const postFile = await getFile(`blog/posts/${slug}.html`);
      if (!postFile) throw new Error('Post file not found — it may already be deleted.');
      await deleteFile(`blog/posts/${slug}.html`, `Delete blog post: ${slug}`, postFile.sha);
      await removeFromIndex(slug);
      if (state.editingSlug === slug) resetToNewPost();
      loadManageView();
    } catch (err) {
      postsListEl.innerHTML = `<p class="admin-status admin-status-error">${escapeHtml(describeError(err, 'deleting this post'))}</p>`;
    }
  }

  // ---------- boot ----------

  updateSlugDisplay();
  init();
})();
