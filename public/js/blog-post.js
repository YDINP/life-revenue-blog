// Blog Post Interactive Features
(function() {
  const copyBtn = document.getElementById('copy-link-btn');
  const tooltip = document.getElementById('copy-tooltip');
  if (copyBtn && tooltip) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        tooltip.classList.add('show');
        setTimeout(() => tooltip.classList.remove('show'), 2000);
      } catch (err) { console.error('Failed to copy:', err); }
    });
  }
})();

// Like button logic
(function() {
  const likeBtn = document.getElementById('like-btn');
  const likeIcon = document.getElementById('like-icon');
  const likeCount = document.getElementById('like-count');
  if (!likeBtn || !likeIcon || !likeCount) return;

  const slug = window.location.pathname.replace(/^\/blog\//, '').replace(/\/$/, '');
  const storageKey = 'liked_' + slug;
  const countKey = 'like_count_' + slug;

  const isLiked = localStorage.getItem(storageKey) === 'true';
  let count = parseInt(localStorage.getItem(countKey) || '0', 10);

  function render() {
    likeCount.textContent = String(count);
    if (isLiked) {
      likeIcon.innerHTML = '&#9829;';
      likeBtn.classList.add('liked');
      likeBtn.disabled = true;
    }
  }
  render();

  likeBtn.addEventListener('click', () => {
    if (localStorage.getItem(storageKey) === 'true') return;
    localStorage.setItem(storageKey, 'true');
    count++;
    localStorage.setItem(countKey, String(count));
    likeIcon.innerHTML = '&#9829;';
    likeBtn.classList.add('liked');
    likeBtn.disabled = true;
    likeCount.textContent = String(count);
    likeBtn.classList.add('like-pop');
    setTimeout(() => likeBtn.classList.remove('like-pop'), 600);
  });
})();

// Auto-generate Table of Contents
(function() {
  const content = document.getElementById('post-content');
  const toc = document.getElementById('toc');
  if (!content || !toc) return;

  const headings = content.querySelectorAll('h2, h3');
  if (headings.length < 2) { toc.style.display = 'none'; return; }

  let html = '<h4>목차</h4><ul>';
  headings.forEach((h, i) => {
    const id = 'heading-' + i;
    h.id = id;
    const indent = h.tagName === 'H3' ? ' class="toc-sub"' : '';
    html += `<li${indent}><a href="#${id}">${h.textContent}</a></li>`;
  });
  html += '</ul>';
  toc.innerHTML = html;

  // Estimate reading time
  const text = content.textContent || '';
  const minutes = Math.max(1, Math.round(text.length / 500));
  const readingEl = document.querySelector('.post-reading-time');
  if (readingEl) readingEl.textContent = `읽기 약 ${minutes}분`;

  // === Chart Rendering System (Enhanced) ===
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // IntersectionObserver for scroll animation
  const chartObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.querySelectorAll('.chart-fill, .radar-score-fill, .versus-fill').forEach(fill => {
          fill.classList.add('animated');
        });
        entry.target.querySelectorAll('.progress-ring').forEach(ring => {
          ring.style.strokeDashoffset = ring.dataset.target;
        });
        chartObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.2 });

  // 1) Render bar charts
  document.querySelectorAll('.chart-bar').forEach(el => {
    const labels = (el.dataset.labels || '').split(',');
    const values = (el.dataset.values || '').split(',').map(Number);
    const colors = (el.dataset.colors || '#3b82f6,#f59e0b,#10b981,#ef4444,#8b5cf6').split(',');
    const title = el.dataset.title || '';
    const unit = el.dataset.unit || '';
    const max = Math.max(...values) * 1.15;

    let html = '';
    if (title) html += `<div class="chart-title">${title}</div>`;
    html += '<div class="chart-bars">';
    labels.forEach((label, i) => {
      const pct = max > 0 ? (values[i] / max) * 100 : 0;
      const color = colors[i % colors.length].trim();
      const grad = `linear-gradient(90deg, ${color}, ${hexToRgba(color, 0.7)})`;
      html += `<div class="chart-row">
        <span class="chart-label">${label.trim()}</span>
        <div class="chart-track">
          <div class="chart-fill" style="width:${pct}%;background:${grad}">
            ${pct > 25 ? `<span class="chart-fill-inner-val">${values[i]}${unit}</span>` : ''}
          </div>
        </div>
        <span class="chart-value">${values[i]}${unit}</span>
      </div>`;
    });
    html += '</div>';
    el.innerHTML = html;
    chartObserver.observe(el);
  });

  // 2) Render radar/score charts
  document.querySelectorAll('.chart-radar').forEach(el => {
    const items = JSON.parse(el.dataset.items || '[]');
    const title = el.dataset.title || '';
    let html = '';
    if (title) html += `<div class="chart-title">${title}</div>`;
    html += '<div class="chart-radar-grid">';
    items.forEach(item => {
      const scores = item.scores || [];
      const avg = scores.length > 0 ? (scores.reduce((a,s) => a + s.value, 0) / scores.length).toFixed(1) : '0';
      const mainColor = scores[0]?.color || '#3b82f6';
      html += `<div class="radar-item">
        <div class="radar-item-accent" style="background:${mainColor}"></div>
        <div class="radar-name" style="color:${mainColor}">${item.name}</div>
        <div class="radar-avg">
          <span class="radar-avg-badge" style="background:${hexToRgba(mainColor, 0.12)};color:${mainColor}">
            평균 ${avg}/10
          </span>
        </div>
        <div class="radar-scores">`;
      scores.forEach(s => {
        const pct = (s.value / 10) * 100;
        const grad = `linear-gradient(90deg, ${s.color || '#3b82f6'}, ${hexToRgba(s.color || '#3b82f6', 0.6)})`;
        html += `<div class="radar-score-row">
          <span class="radar-score-label">${s.label}</span>
          <div class="radar-score-track">
            <div class="radar-score-fill" style="width:${pct}%;background:${grad}"></div>
          </div>
          <span class="radar-score-val" style="color:${s.color || '#3b82f6'}">${s.value}</span>
        </div>`;
      });
      html += '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
    chartObserver.observe(el);
  });

  // 3) Render donut charts
  document.querySelectorAll('.chart-donut').forEach(el => {
    const labels = (el.dataset.labels || '').split(',');
    const values = (el.dataset.values || '').split(',').map(Number);
    const colors = (el.dataset.colors || '#3b82f6,#10b981,#f59e0b,#ef4444,#8b5cf6').split(',');
    const title = el.dataset.title || '';
    const unit = el.dataset.unit || '';
    const total = values.reduce((a, v) => a + v, 0);

    let gradient = '';
    let cumPct = 0;
    values.forEach((v, i) => {
      const pct = total > 0 ? (v / total) * 100 : 0;
      const color = colors[i % colors.length].trim();
      gradient += `${color} ${cumPct}% ${cumPct + pct}%`;
      cumPct += pct;
      if (i < values.length - 1) gradient += ', ';
    });

    let html = '';
    if (title) html += `<div class="chart-title">${title}</div>`;
    html += '<div class="chart-donut-container">';
    html += `<div class="donut-ring" style="background:conic-gradient(${gradient})">`;
    html += `<div class="donut-hole"><span class="donut-total">${total}${unit}</span><span class="donut-total-label">합계</span></div>`;
    html += '</div>';
    html += '<div class="donut-legend">';
    labels.forEach((label, i) => {
      const pct = total > 0 ? ((values[i] / total) * 100).toFixed(1) : '0';
      html += `<div class="donut-legend-item">
        <span class="donut-legend-dot" style="background:${colors[i % colors.length].trim()}"></span>
        <span class="donut-legend-label">${label.trim()}</span>
        <span class="donut-legend-value">${values[i]}${unit} (${pct}%)</span>
      </div>`;
    });
    html += '</div></div>';
    el.innerHTML = html;
  });

  // 4) Render versus charts
  document.querySelectorAll('.chart-versus').forEach(el => {
    const items = JSON.parse(el.dataset.items || '[]');
    const title = el.dataset.title || '';
    const nameA = el.dataset.nameA || 'A';
    const nameB = el.dataset.nameB || 'B';
    const colorA = el.dataset.colorA || '#3b82f6';
    const colorB = el.dataset.colorB || '#10b981';
    const maxVal = Math.max(...items.flatMap(i => [i.a, i.b])) * 1.1;

    let html = '';
    if (title) html += `<div class="chart-title">${title}</div>`;
    html += `<div class="versus-header">
      <span class="versus-name" style="color:${colorA}">${nameA}</span>
      <span class="versus-vs">VS</span>
      <span class="versus-name" style="color:${colorB}">${nameB}</span>
    </div>`;
    html += '<div class="versus-rows">';
    items.forEach(item => {
      const pctA = maxVal > 0 ? (item.a / maxVal) * 100 : 0;
      const pctB = maxVal > 0 ? (item.b / maxVal) * 100 : 0;
      html += `<div class="versus-row">
        <div class="versus-bar-left">
          <span class="versus-val">${item.a}</span>
          <div class="versus-track versus-track-left">
            <div class="versus-fill" style="width:${pctA}%;background:linear-gradient(270deg, ${colorA}, ${hexToRgba(colorA, 0.6)})"></div>
          </div>
        </div>
        <div class="versus-label">${item.label}</div>
        <div class="versus-bar-right">
          <div class="versus-track">
            <div class="versus-fill" style="width:${pctB}%;background:linear-gradient(90deg, ${colorB}, ${hexToRgba(colorB, 0.6)})"></div>
          </div>
          <span class="versus-val">${item.b}</span>
        </div>
      </div>`;
    });
    html += '</div>';
    el.innerHTML = html;
    chartObserver.observe(el);
  });

  // 5) Render progress circle charts
  document.querySelectorAll('.chart-progress').forEach(el => {
    const labels = (el.dataset.labels || '').split(',');
    const values = (el.dataset.values || '').split(',').map(Number);
    const colors = (el.dataset.colors || '#3b82f6,#10b981,#f59e0b,#ef4444,#8b5cf6').split(',');
    const title = el.dataset.title || '';
    const max = Number(el.dataset.max || '100');
    const unit = el.dataset.unit || '';
    const circumference = 2 * Math.PI * 45;

    let html = '';
    if (title) html += `<div class="chart-title">${title}</div>`;
    html += '<div class="progress-grid">';
    labels.forEach((label, i) => {
      const pct = Math.min(values[i] / max, 1);
      const offset = circumference - (circumference * pct);
      const color = colors[i % colors.length].trim();
      html += `<div class="progress-item">
        <div class="progress-circle">
          <svg viewBox="0 0 100 100">
            <circle class="progress-bg" cx="50" cy="50" r="45" />
            <circle class="progress-ring" cx="50" cy="50" r="45"
              style="stroke:${color};stroke-dasharray:${circumference};stroke-dashoffset:${circumference}"
              data-target="${offset}" />
          </svg>
          <div class="progress-value" style="color:${color}">${values[i]}${unit}</div>
        </div>
        <div class="progress-label">${label.trim()}</div>
      </div>`;
    });
    html += '</div>';
    el.innerHTML = html;
    chartObserver.observe(el);
  });
})();

// ===== Code Copy Button =====
(function() {
  const content = document.getElementById('post-content');
  if (!content) return;
  content.querySelectorAll('pre').forEach(pre => {
    if (pre.parentElement.classList.contains('code-block-wrapper')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.textContent = '복사';
    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code') || pre;
      try {
        await navigator.clipboard.writeText(code.textContent);
        btn.textContent = '복사됨!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = '복사'; btn.classList.remove('copied'); }, 2000);
      } catch(e) { btn.textContent = '실패'; }
    });
    wrapper.appendChild(btn);
  });
})();

// ===== ToC Scroll Highlight =====
(function() {
  const toc = document.getElementById('toc');
  const content = document.getElementById('post-content');
  if (!toc || !content) return;
  const headings = content.querySelectorAll('h2[id], h3[id]');
  if (headings.length < 2) return;
  const tocLinks = toc.querySelectorAll('a');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        tocLinks.forEach(a => a.classList.remove('toc-active'));
        const active = toc.querySelector(`a[href="#${entry.target.id}"]`);
        if (active) active.classList.add('toc-active');
      }
    });
  }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });
  headings.forEach(h => observer.observe(h));
})();

// ===== Sticky ToC Sidebar (Desktop) =====
(function() {
  if (window.innerWidth < 1280) return;
  const inlineToc = document.getElementById('toc');
  const content = document.getElementById('post-content');
  if (!inlineToc || !content) return;
  const headings = content.querySelectorAll('h2[id], h3[id]');
  if (headings.length < 2) return;

  const sidebar = document.createElement('nav');
  sidebar.className = 'toc-sidebar';
  sidebar.innerHTML = `
    <div class="toc-sidebar-header">
      <span class="toc-sidebar-title">목차</span>
      <button class="toc-sidebar-close" aria-label="목차 닫기">&times;</button>
    </div>
    ${inlineToc.innerHTML.replace(/<h4[^>]*>.*?<\/h4>/i, '')}
    <div class="toc-progress"><div class="toc-progress-bar"></div></div>
  `;
  document.body.appendChild(sidebar);

  sidebar.querySelector('.toc-sidebar-close').addEventListener('click', function() {
    sidebar.classList.add('toc-hidden');
  });

  const sidebarLinks = sidebar.querySelectorAll('a');
  const sidebarObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        sidebarLinks.forEach(a => a.classList.remove('toc-active'));
        const active = sidebar.querySelector(`a[href="#${entry.target.id}"]`);
        if (active) {
          active.classList.add('toc-active');
          active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    });
  }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });
  headings.forEach(h => sidebarObserver.observe(h));

  const progressBar = sidebar.querySelector('.toc-progress-bar');
  if (progressBar) {
    window.addEventListener('scroll', function() {
      const rect = content.getBoundingClientRect();
      const total = content.scrollHeight;
      const scrolled = Math.max(0, -rect.top);
      const pct = Math.min(100, (scrolled / (total - window.innerHeight)) * 100);
      progressBar.style.width = pct + '%';
    }, { passive: true });
  }

  const visObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!sidebar.classList.contains('toc-hidden')) {
        sidebar.style.opacity = entry.isIntersecting ? '1' : '0.3';
      }
    });
  }, { threshold: 0.01 });
  visObserver.observe(content);
})();

// ===== Accordion FAQ =====
(function() {
  const content = document.getElementById('post-content');
  if (!content) return;
  const faqHeading = Array.from(content.querySelectorAll('h2')).find(
    h => h.textContent.includes('자주 묻는 질문') || h.textContent.includes('FAQ')
  );
  if (!faqHeading) return;
  const items = [];
  let el = faqHeading.nextElementSibling;
  let currentQ = null;
  let currentA = [];
  while (el && el.tagName !== 'H2') {
    if (el.tagName === 'H3') {
      if (currentQ) items.push({ q: currentQ, a: currentA.join('') });
      currentQ = el.textContent.replace(/^Q\d*[\.\:]\s*/, '').replace(/^\d+\.\s*/, '');
      currentA = [];
    } else if (currentQ) {
      currentA.push(el.outerHTML);
    }
    el = el.nextElementSibling;
  }
  if (currentQ) items.push({ q: currentQ, a: currentA.join('') });
  if (items.length === 0) return;
  const container = document.createElement('div');
  container.className = 'faq-accordion';
  items.forEach(item => {
    const details = document.createElement('details');
    details.className = 'faq-item';
    details.innerHTML = `<summary>${item.q}</summary><div class="faq-answer">${item.a}</div>`;
    container.appendChild(details);
  });
  let removeEl = faqHeading.nextElementSibling;
  while (removeEl && removeEl.tagName !== 'H2') {
    const next = removeEl.nextElementSibling;
    removeEl.remove();
    removeEl = next;
  }
  faqHeading.after(container);
})();

// ===== Difficulty Badge (auto-detect) =====
(function() {
  const content = document.getElementById('post-content');
  const meta = document.querySelector('.post-meta');
  if (!content || !meta) return;
  const text = content.textContent || '';
  const codeBlocks = content.querySelectorAll('pre code').length;
  const length = text.length;
  let level = 'beginner';
  let label = '초급';
  let icon = '\uD83D\uDFE2';
  if (length > 8000 || codeBlocks > 5) {
    level = 'advanced'; label = '고급'; icon = '\uD83D\uDD34';
  } else if (length > 4000 || codeBlocks > 2) {
    level = 'intermediate'; label = '중급'; icon = '\uD83D\uDFE1';
  }
  const badge = document.createElement('span');
  badge.className = `difficulty-badge ${level}`;
  badge.textContent = `${icon} ${label}`;
  meta.appendChild(badge);
})();

// ===== Bookmark Toggle =====
(function() {
  const btn = document.getElementById('bookmark-btn');
  if (!btn) return;
  const slug = btn.dataset.slug || '';
  const KEY = 'blog_bookmarks';
  function getBookmarks() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  }
  function isBookmarked() { return getBookmarks().includes(slug); }
  function render() {
    const icon = btn.querySelector('.bookmark-icon');
    if (isBookmarked()) {
      btn.classList.add('bookmarked');
      if (icon) { icon.setAttribute('fill', 'currentColor'); }
    } else {
      btn.classList.remove('bookmarked');
      if (icon) { icon.setAttribute('fill', 'none'); }
    }
  }
  btn.addEventListener('click', function() {
    let bm = getBookmarks();
    if (bm.includes(slug)) {
      bm = bm.filter(s => s !== slug);
    } else {
      bm.push(slug);
    }
    localStorage.setItem(KEY, JSON.stringify(bm));
    render();
  });
  render();
})();

// ===== Interactive Table Sort =====
(function() {
  const content = document.getElementById('post-content');
  if (!content) return;
  content.querySelectorAll('table').forEach(function(table) {
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;
    const headers = thead.querySelectorAll('th');
    if (headers.length < 2) return;
    table.classList.add('sortable-table');
    headers.forEach(function(th, colIdx) {
      th.style.cursor = 'pointer';
      th.setAttribute('title', '클릭하여 정렬');
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      arrow.textContent = ' ↕';
      th.appendChild(arrow);
      let asc = true;
      th.addEventListener('click', function() {
        const rows = Array.from(tbody.querySelectorAll('tr'));
        rows.sort(function(a, b) {
          const aText = (a.children[colIdx]?.textContent || '').trim();
          const bText = (b.children[colIdx]?.textContent || '').trim();
          const aNum = parseFloat(aText.replace(/[^0-9.\-]/g, ''));
          const bNum = parseFloat(bText.replace(/[^0-9.\-]/g, ''));
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return asc ? aNum - bNum : bNum - aNum;
          }
          return asc ? aText.localeCompare(bText, 'ko') : bText.localeCompare(aText, 'ko');
        });
        rows.forEach(r => tbody.appendChild(r));
        headers.forEach(h => {
          const a = h.querySelector('.sort-arrow');
          if (a) a.textContent = ' ↕';
        });
        arrow.textContent = asc ? ' ↑' : ' ↓';
        asc = !asc;
      });
    });
  });
})();

// ===== Popular Posts Widget =====
(function() {
  const widget = document.getElementById('popular-posts-widget');
  const list = document.getElementById('popular-posts-list');
  if (!widget || !list) return;
  const SUPABASE_URL = 'https://xyprbsmagtlzebxyxsvj.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5cHJic21hZ3RsemVieHl4c3ZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0NjY4NTQsImV4cCI6MjA4NjA0Mjg1NH0.dajN0n0IWzOgYOSCglxVLzddg7jJFRHNCHwTWMG62uU';
  fetch(`${SUPABASE_URL}/rest/v1/analytics?select=page_path,page_views&order=page_views.desc&limit=5&page_path=like./blog/*`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  })
  .then(r => r.json())
  .then(function(data) {
    if (!Array.isArray(data) || data.length === 0) {
      list.innerHTML = '<p class="popular-posts-empty">아직 충분한 데이터가 없습니다.</p>';
      return;
    }
    list.innerHTML = data.map(function(item, i) {
      const path = item.page_path || '';
      const title = path.replace(/^\/blog\//, '').replace(/\/$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const views = item.page_views || 0;
      return `<a href="${path}" class="popular-post-item">
        <span class="popular-post-rank">${i + 1}</span>
        <span class="popular-post-title">${title}</span>
        <span class="popular-post-views">${views.toLocaleString()} views</span>
      </a>`;
    }).join('');
  })
  .catch(function() {
    list.innerHTML = '<p class="popular-posts-empty">인기글을 불러올 수 없습니다.</p>';
  });
})();
