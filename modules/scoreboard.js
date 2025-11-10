// scoreboard.js
// Encapsulates top-scores persistence and UI rendering.
export const SCORE_KEY = 'faceScroller_topScores';
let topScores = [];
let pendingScore = null;

export function loadScores() {
  try {
    const raw = localStorage.getItem(SCORE_KEY);
    topScores = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(topScores)) topScores = [];
  } catch (e) {
    console.warn('Failed to load scores', e);
    topScores = [];
  }
}

export function saveScores() {
  try {
    localStorage.setItem(SCORE_KEY, JSON.stringify(topScores));
  } catch (e) {
    console.warn('Failed to save scores', e);
  }
}

export function renderScores() {
  const el = document.getElementById('scoreList');
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const row = document.createElement('li');
    row.className = 'scoreRow';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'scoreName';
    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'scoreValue';
    if (topScores[i]) {
      nameSpan.textContent = `${i+1}. ${topScores[i].name}`;
      scoreSpan.textContent = `${topScores[i].score}`;
    } else {
      nameSpan.textContent = `${i+1}. \u2014`;
      scoreSpan.textContent = `0`;
    }
    row.appendChild(nameSpan);
    row.appendChild(scoreSpan);
    el.appendChild(row);
  }
}

export function checkHighScore(s) {
  const scores = topScores.map(x => x.score).slice();
  scores.push(s);
  scores.sort((a,b)=>b-a);
  const rank = scores.indexOf(s);
  if (rank >=0 && rank < 5) {
    pendingScore = s;
    const prompt = document.getElementById('namePrompt');
    if (prompt) {
      prompt.style.display = 'block';
      const input = document.getElementById('playerName');
      if (input) { input.value = ''; input.focus(); }
    }
  } else {
    pendingScore = null;
  }
}

export function commitName(name) {
  if (!pendingScore) return;
  const entry = { name: name || 'Anon', score: pendingScore };
  topScores.push(entry);
  topScores.sort((a,b)=>b.score - a.score);
  topScores = topScores.slice(0,5);
  saveScores();
  renderScores();
  pendingScore = null;
  const prompt = document.getElementById('namePrompt');
  if (prompt) prompt.style.display = 'none';
}

export function resetScores() {
  topScores = [];
  saveScores();
  renderScores();
}
