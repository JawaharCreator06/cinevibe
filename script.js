/* === Constants === */
const FAVORITES_KEY = "cinevibe_favorites_v1";
const THEME_KEY = "cinevibe_theme_v1";
const PAGE_SIZE = 8;
const OMDB_API_KEY = "265a901b";
const OMDB_BASE_URL = "https://www.omdbapi.com/";
const API_TIMEOUT = 10000;
const MAX_RETRIES = 3;

/* where-to-watch fallback map for known titles (used when OMDb Website not provided) */
const WHERE_TO_WATCH_MAP = {
  "Inception": "Netflix",
  "The Matrix": "HBO Max",
  "Interstellar": "Paramount+",
  "Avatar": "Disney+",
  "Dune": "Max",
  "Gladiator": "Prime Video",
  "The Dark Knight": "Netflix",
  "Pulp Fiction": "Prime Video",
  "Oppenheimer": "Prime Video",
  "Barbie": "HBO Max",
  "Parasite": "Hulu",
  "Joker": "HBO Max",
  "The Shawshank Redemption": "Netflix",
  "The Godfather": "Prime Video",
  "Fight Club": "HBO Max",
  "Forrest Gump": "Paramount+",
  "The Lord of the Rings: The Return of the King": "Max"
};

/* OTT platform logos from internet (using public CDN URLs) */
const OTT_LOGOS = {
  "Netflix": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/1198px-Netflix_2015_logo.svg.png",
  "Prime Video": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Amazon_Prime_Video_logo.svg/1200px-Amazon_Prime_Video_logo.svg.png",
  "Disney+": "https://upload.wikimedia.org/wikipedia/en/thumb/1/1b/Disney_Plus_logo.svg/1200px-Disney_Plus_logo.svg.png",
  "HBO Max": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/HBO_Max_logo.svg/1200px-HBO_Max_logo.svg.png",
  "Hulu": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Hulu_logo.svg/1200px-Hulu_logo.svg.png",
  "Paramount+": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Paramount%2B_logo.svg/1200px-Paramount%2B_logo.svg.png",
  "Max": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/HBO_Max_logo.svg/1200px-HBO_Max_logo.svg.png",
  "Other": "https://via.placeholder.com/48x28/777/ffffff?text=OTT"
};

/* === DOM References === */
const genreSelect = document.getElementById("genreSelect");
const moodSelect = document.getElementById("moodSelect");
const languageSelect = document.getElementById("languageSelect");
const searchInput = document.getElementById("searchInput");
const minRatingRange = document.getElementById("minRatingRange");
const minRatingLabel = document.getElementById("minRatingLabel");
const streamingOnlyToggle = document.getElementById("streamingOnlyToggle");
const sortSelect = document.getElementById("sortSelect");
const moviesGrid = document.getElementById("moviesGrid");
const resultsSummary = document.getElementById("resultsSummary");
const emptyState = document.getElementById("emptyState");
const resetFiltersBtns = document.querySelectorAll("#resetFiltersBtn, #resetFiltersBtn-empty");
const themeToggle = document.getElementById("themeToggle");
const favoritesToggleBtn = document.getElementById("favoritesToggleBtn");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const loadMoreBtn = document.getElementById("loadMoreBtn");

const movieModal = document.getElementById("movieModal");
const modalOverlay = document.getElementById("modalOverlay");
const modalCloseBtn = document.getElementById("modalCloseBtn");
const modalPoster = document.getElementById("modalPoster");
const modalTitle = document.getElementById("modalTitle");
const modalMeta = document.getElementById("modalMeta");
const modalBadges = document.getElementById("modalBadges");
const modalDescription = document.getElementById("modalDescription");
const modalFavBtn = document.getElementById("modalFavBtn");
const modalImdbLink = document.getElementById("modalImdbLink");

/* === State === */
let favorites = new Set();
let lastRendered = [];
let showOnlyFavorites = false;
let visibleCount = 0;
let currentModalMovie = null;
let searchCache = new Map();
let isSearching = false;

/* ========== API FUNCTIONS ========== */

async function fetchFromOmdb(params, retryCount = 0) {
  try {
    const queryString = new URLSearchParams({
      apikey: OMDB_API_KEY,
      ...params,
    }).toString();

    const url = `${OMDB_BASE_URL}?${queryString}`;
    console.log("🔍 Fetching:", url.replace(OMDB_API_KEY, "***"));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.Response === "False") {
      console.warn("⚠️ OMDb Error:", data.Error);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`❌ Fetch error (attempt ${retryCount + 1}):`, error && error.message ? error.message : error);

    if (retryCount < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (retryCount + 1)));
      return fetchFromOmdb(params, retryCount + 1);
    }

    return null;
  }
}

async function searchMoviesByTitle(title, page = 1) {
  const cacheKey = `${title}_${page}`;

  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey);
  }

  const data = await fetchFromOmdb({
    s: title,
    type: "movie",
    page: page,
  });

  if (data) {
    searchCache.set(cacheKey, data);
  }

  return data;
}

async function getMovieDetails(imdbId) {
  const cacheKey = `detail_${imdbId}`;

  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey);
  }

  const data = await fetchFromOmdb({
    i: imdbId,
    plot: "full",
  });

  if (data) {
    searchCache.set(cacheKey, data);
  }

  return data;
}

async function batchFetchMovieDetails(imdbIds) {
  const batchSize = 5;
  const results = [];

  for (let i = 0; i < imdbIds.length; i += batchSize) {
    const batch = imdbIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((id) => getMovieDetails(id)));
    results.push(...batchResults);

    if (i + batchSize < imdbIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return results;
}

/* ========== DATA TRANSFORMATION ========== */

function transformOmdbData(omdbMovie) {
  if (!omdbMovie || omdbMovie.Response === "False") {
    return null;
  }

  const genres = (omdbMovie.Genre || "").split(",").map((g) => g.trim()).filter(Boolean);
  const primaryGenre = genres[0] || "Unknown";

  let moods = [];
  const genreLower = (omdbMovie.Genre || "").toLowerCase();

  if (genreLower.includes("comedy")) moods.push("feel-good");
  if (genreLower.includes("family") || genreLower.includes("animation")) moods.push("family");
  if (genreLower.includes("horror") || genreLower.includes("thriller")) moods.push("dark", "intense");
  if (genreLower.includes("drama")) moods.push("thoughtful");
  if (genreLower.includes("sci-fi") || genreLower.includes("adventure")) moods.push("intense", "thoughtful");
  if (genreLower.includes("romance")) moods.push("feel-good");
  if (moods.length === 0) moods = ["thoughtful"];

  const rating = parseFloat(omdbMovie.imdbRating) || 0;
  const runtimeMatch = (omdbMovie.Runtime || "").match(/(\d+)/);
  const runtime = runtimeMatch ? parseInt(runtimeMatch[1], 10) : 0;

  const actors = (omdbMovie.Actors || "").split(",").map((a) => a.trim()).filter(Boolean).slice(0, 2);
  const director = (omdbMovie.Director || "").split(",")[0] ? (omdbMovie.Director || "").split(",")[0].trim() : "";

  const tags = [];
  if (director) tags.push(director);
  if (actors.length > 0) tags.push(...actors);
  if (genres.length > 0) tags.push(...genres.slice(0, 2));

  const languages = (omdbMovie.Language || "").split(",").map((l) => l.trim()).filter(Boolean);

  const website = (omdbMovie.Website && omdbMovie.Website !== "N/A") ? omdbMovie.Website : null;
  const where = website || WHERE_TO_WATCH_MAP[omdbMovie.Title] || "Other";

  return {
    title: omdbMovie.Title || "Untitled",
    year: parseInt((omdbMovie.Year || "").slice(0, 4), 10) || 0,
    genre: primaryGenre,
    runtime,
    moods,
    rating,
    tags: tags.slice(0, 5),
    streaming: true,
    poster:
      omdbMovie.Poster && omdbMovie.Poster !== "N/A"
        ? omdbMovie.Poster
        : "https://via.placeholder.com/400x600/020617/6366f1?text=" + encodeURIComponent(omdbMovie.Title || "No+Image"),
    description: omdbMovie.Plot || "No description available",
    imdb: omdbMovie.imdbID || null,
    where,
    languages,
    score: 0,
  };
}

function calculateScore(movie, filters) {
  let score = 50;

  if (filters.genre !== "any" && movie.genre === filters.genre) {
    score += 25;
  }

  if (filters.mood !== "any" && movie.moods && movie.moods.includes(filters.mood)) {
    score += 25;
  }

  const ratingDelta = Math.max(0, movie.rating - filters.minRating);
  score += Math.min(25, ratingDelta * 5);

  return Math.min(score, 100);
}

function getFilters() {
  return {
    searchText: searchInput ? searchInput.value.trim() : "",
    genre: genreSelect ? genreSelect.value : "any",
    mood: moodSelect ? moodSelect.value : "any",
    language: languageSelect ? languageSelect.value : "any",
    minRating: minRatingRange ? parseFloat(minRatingRange.value) : 0,
    streamingOnly: streamingOnlyToggle ? streamingOnlyToggle.checked : false,
    sortBy: sortSelect ? sortSelect.value : "score-desc",
  };
}

function createScoreBadge(score, rating) {
  const badge = document.createElement("div");
  badge.classList.add("score-badge");

  if (score < 55) {
    badge.classList.add("score-badge--low");
  } else if (score < 75) {
    badge.classList.add("score-badge--medium");
  }

  const scoreSpan = document.createElement("span");
  scoreSpan.textContent = `${Math.round(score)}% match`;

  const ratingSpan = document.createElement("span");
  ratingSpan.textContent = `• ${isFinite(rating) ? rating.toFixed(1) : "N/A"}`;

  badge.appendChild(scoreSpan);
  badge.appendChild(ratingSpan);

  return badge;
}

function createOTTLogoElement(platform) {
  const container = document.createElement("img");
  container.className = "ott-logo-img";
  container.alt = platform;
  container.title = platform;
  container.width = 48;
  container.height = 28;
  container.style.display = "inline-block";
  container.style.cursor = "pointer";
  container.style.objectFit = "contain";
  container.style.backgroundColor = "#f0f0f0";
  container.style.borderRadius = "4px";
  container.src = OTT_LOGOS[platform] || OTT_LOGOS["Other"];
  container.onerror = () => {
    container.src = OTT_LOGOS["Other"];
  };
  return container;
}

/* ========== RENDERING FUNCTIONS ========== */

function renderMovies(list, filters) {
  lastRendered = list || [];
  moviesGrid.innerHTML = "";
  visibleCount = 0;
  if (loadMoreBtn) loadMoreBtn.hidden = true;

  if (!Array.isArray(list) || list.length === 0) {
    if (emptyState) emptyState.hidden = false;
    if (resultsSummary) resultsSummary.textContent = "No movies found. Try a different search.";
    return;
  }

  if (emptyState) emptyState.hidden = true;

  const slice = list.slice(0, PAGE_SIZE);
  visibleCount = slice.length;

  if (resultsSummary) resultsSummary.textContent = `${list.length} result${list.length !== 1 ? "s" : ""} found • Showing ${visibleCount}`;

  slice.forEach((movie) => {
    const card = createMovieCard(movie);
    moviesGrid.appendChild(card);
  });

  if (lastRendered.length > visibleCount && loadMoreBtn) {
    loadMoreBtn.hidden = false;
  }
}

function createMovieCard(movie) {
  const card = document.createElement("article");
  card.className = "movie-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${movie.title} — open details`);

  const posterWrap = document.createElement("div");
  posterWrap.className = "movie-poster-wrap";

  const img = document.createElement("img");
  img.className = "movie-poster";
  img.src = movie.poster;
  img.alt = `${movie.title} poster`;
  img.loading = "lazy";
  img.onerror = () => {
    img.src = "https://via.placeholder.com/400x600/020617/ffffff?text=No+Image";
  };

  const posterGradient = document.createElement("div");
  posterGradient.className = "poster-gradient";

  const favBtn = document.createElement("button");
  favBtn.type = "button";
  favBtn.className = "favorite-button";
  favBtn.textContent = favorites.has(movie.title) ? "★" : "☆";
  if (favorites.has(movie.title)) {
    favBtn.classList.add("favorite-button--active");
  }
  favBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    toggleFavorite(movie.title, favBtn);
  });

  posterWrap.appendChild(img);
  posterWrap.appendChild(posterGradient);
  posterWrap.appendChild(favBtn);

  const content = document.createElement("div");
  content.className = "movie-content";

  const header = document.createElement("div");
  header.className = "movie-header";

  const titleBlock = document.createElement("div");
  const title = document.createElement("div");
  title.className = "movie-title";
  title.textContent = movie.title;

  const meta = document.createElement("div");
  meta.className = "movie-meta";
  meta.textContent = `${movie.year} • ${movie.genre}`;

  titleBlock.appendChild(title);
  titleBlock.appendChild(meta);

  const scoreBadge = createScoreBadge(movie.score || 0, movie.rating || 0);
  header.appendChild(titleBlock);
  header.appendChild(scoreBadge);

  const pillRow = document.createElement("div");
  pillRow.className = "movie-pill-row";

  const genrePill = document.createElement("div");
  genrePill.className = "pill pill--genre";
  genrePill.textContent = movie.genre;

  const moodPill = document.createElement("div");
  moodPill.className = "pill pill--mood";
  moodPill.textContent = movie.moods && movie.moods[0] ? movie.moods[0].replace("-", " ") : "Unknown";

  const yearPill = document.createElement("div");
  yearPill.className = "pill pill--year";
  yearPill.textContent = movie.year;

  pillRow.appendChild(genrePill);
  pillRow.appendChild(moodPill);
  pillRow.appendChild(yearPill);

  if (movie.languages && movie.languages.length > 0) {
    const langPill = document.createElement("div");
    langPill.className = "pill pill--language";
    langPill.textContent = movie.languages[0];
    pillRow.appendChild(langPill);
  }

  const tagsRow = document.createElement("div");
  tagsRow.className = "tags-row";

  (movie.tags || []).slice(0, 3).forEach((tag) => {
    const tagEl = document.createElement("span");
    tagEl.className = "tag";
    tagEl.textContent = tag;
    tagsRow.appendChild(tagEl);
  });

  // show OTT logo always
  if (movie.where) {
    const whereEl = document.createElement("span");
    whereEl.className = "tag tag--where";

    if (typeof movie.where === "string" && (movie.where.startsWith("http://") || movie.where.startsWith("https://"))) {
      const a = document.createElement("a");
      a.href = movie.where;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Watch";
      whereEl.appendChild(a);
    } else {
      // show OTT logo from internet
      const logoEl = createOTTLogoElement(movie.where);
      whereEl.appendChild(logoEl);
    }

    tagsRow.appendChild(whereEl);
  }

  if (movie.streaming) {
    const streamTag = document.createElement("span");
    streamTag.className = "tag tag--stream";
    streamTag.textContent = "Streaming";
    tagsRow.appendChild(streamTag);
  }

  const desc = document.createElement("p");
  desc.className = "movie-description";
  desc.textContent = movie.description || "No description available";

  content.appendChild(header);
  content.appendChild(pillRow);
  content.appendChild(tagsRow);
  content.appendChild(desc);

  card.appendChild(posterWrap);
  card.appendChild(content);

  card.addEventListener("click", () => openModalForMovie(movie));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openModalForMovie(movie);
    }
  });

  return card;
}

function loadMore() {
  const nextSlice = lastRendered.slice(visibleCount, visibleCount + PAGE_SIZE);
  nextSlice.forEach((movie) => {
    const card = createMovieCard(movie);
    moviesGrid.appendChild(card);
  });

  visibleCount += nextSlice.length;

  if (resultsSummary) resultsSummary.textContent = `${lastRendered.length} results found • Showing ${visibleCount}`;

  if (visibleCount >= lastRendered.length && loadMoreBtn) {
    loadMoreBtn.hidden = true;
  }
}

/* ========== MODAL FUNCTIONS ========== */

function openModalForMovie(movie) {
  currentModalMovie = movie;
  if (movieModal) movieModal.setAttribute("aria-hidden", "false");

  if (modalPoster) {
    modalPoster.src = movie.poster;
    modalPoster.alt = `${movie.title} poster`;
  }

  if (modalTitle) modalTitle.textContent = movie.title;

  const metaText = [
    movie.year,
    movie.genre,
    movie.runtime ? `${movie.runtime} min` : "",
    movie.rating ? `${movie.rating.toFixed(1)} ⭐` : "N/A",
    (movie.languages && movie.languages.length > 0) ? movie.languages[0] : ""
  ]
    .filter(Boolean)
    .join(" • ");

  if (modalMeta) modalMeta.textContent = metaText;

  if (modalBadges) {
    modalBadges.innerHTML = "";
    (movie.tags || []).forEach((tag) => {
      const badge = document.createElement("span");
      badge.className = "pill pill--genre";
      badge.textContent = tag;
      modalBadges.appendChild(badge);
    });

    if (movie.where) {
      const whereBadge = document.createElement("span");
      whereBadge.className = "pill pill--where";
      
      if (typeof movie.where === "string" && (movie.where.startsWith("http://") || movie.where.startsWith("https://"))) {
        const a = document.createElement("a");
        a.href = movie.where;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Watch";
        whereBadge.appendChild(a);
      } else {
        const logoEl = createOTTLogoElement(movie.where);
        whereBadge.appendChild(logoEl);
      }
      
      modalBadges.appendChild(whereBadge);
    }
  }

  if (modalDescription) modalDescription.textContent = movie.description || "No description available";

  const isFavorited = favorites.has(movie.title);
  if (modalFavBtn) {
    modalFavBtn.textContent = isFavorited ? "★ Favorited" : "★ Add to Favorites";
    modalFavBtn.classList.toggle("btn-primary", isFavorited);
    modalFavBtn.classList.toggle("btn-secondary", !isFavorited);
  }

  if (modalImdbLink) {
    modalImdbLink.href = movie.imdb ? `https://www.imdb.com/title/${movie.imdb}` : "#";
    modalImdbLink.textContent = movie.imdb ? "Open on IMDb →" : "IMDb Unavailable";
  }

  if (movieModal) {
    movieModal.style.display = "flex";
    document.body.style.overflow = "hidden";
  }
}

function closeModal() {
  if (movieModal) movieModal.setAttribute("aria-hidden", "true");
  if (movieModal) movieModal.style.display = "none";
  document.body.style.overflow = "";
  currentModalMovie = null;
}

/* ========== FAVORITES ========== */

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      favorites = new Set(parsed);
    }
  } catch {
    favorites = new Set();
  }
}

function saveFavorites() {
  const arr = Array.from(favorites);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(arr));
}

function toggleFavorite(title, buttonEl = null) {
  if (!title) return;
  if (favorites.has(title)) {
    favorites.delete(title);
  } else {
    favorites.add(title);
  }

  saveFavorites();

  if (buttonEl) {
    const isFav = favorites.has(title);
    buttonEl.textContent = isFav ? "★" : "☆";
    buttonEl.classList.toggle("favorite-button--active", isFav);
  }

  if (currentModalMovie && currentModalMovie.title === title && modalFavBtn) {
    const isFav = favorites.has(title);
    modalFavBtn.textContent = isFav ? "★ Favorited" : "★ Add to Favorites";
    modalFavBtn.classList.toggle("btn-primary", isFav);
    modalFavBtn.classList.toggle("btn-secondary", !isFav);
  }
}

/* ========== THEME ========== */

function initThemeToggle() {
  let dark = true;

  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light") dark = false;
  } catch {}

  applyTheme(dark);

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      dark = !dark;
      applyTheme(dark);
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    });
  }
}

function applyTheme(dark) {
  if (dark) {
    document.documentElement.style.setProperty("--bg", "#020617");
    document.body.style.background =
      "radial-gradient(circle at top left, rgba(129, 140, 248, 0.38), transparent 55%), radial-gradient(circle at top right, rgba(56, 189, 248, 0.36), transparent 55%), radial-gradient(circle at bottom, #020617 0, #020617 55%)";
    if (themeToggle) themeToggle.textContent = "🌙";
  } else {
    document.documentElement.style.setProperty("--bg", "#f3f4f6");
    document.body.style.background =
      "radial-gradient(circle at top left, rgba(100, 116, 139, 0.2), transparent 55%), radial-gradient(circle at top right, rgba(148, 163, 184, 0.15), transparent 55%), radial-gradient(circle at bottom, #f3f4f6 0, #f3f4f6 55%)";
    if (themeToggle) themeToggle.textContent = "☀️";
  }
}

function populateGenres() {
  if (!genreSelect) return;
  const genres = [
    "any",
    "Action",
    "Adventure",
    "Animation",
    "Biography",
    "Comedy",
    "Crime",
    "Documentary",
    "Drama",
    "Family",
    "Fantasy",
    "History",
    "Horror",
    "Musical",
    "Mystery",
    "Romance",
    "Sci-Fi",
    "Thriller",
    "War",
    "Western",
  ];

  genreSelect.innerHTML = "";
  genres.forEach((genre) => {
    const option = document.createElement("option");
    option.value = genre;
    option.textContent = genre.charAt(0).toUpperCase() + genre.slice(1);
    genreSelect.appendChild(option);
  });
}

function populateLanguages() {
  if (!languageSelect) return;
  const languages = [
    "any",
    "English",
    "Spanish",
    "French",
    "German",
    "Italian",
    "Portuguese",
    "Russian",
    "Chinese",
    "Japanese",
    "Korean",
    "Hindi",
    "Arabic",
    "Turkish",
    "Dutch",
    "Swedish",
    "Danish"
  ];

  languageSelect.innerHTML = "";
  languages.forEach((lang) => {
    const option = document.createElement("option");
    option.value = lang;
    option.textContent = lang;
    languageSelect.appendChild(option);
  });
}

function loadTopRatedOnOpen() {
  const seedTitles = [
    "The Shawshank Redemption",
    "The Godfather",
    "The Dark Knight",
    "Pulp Fiction",
    "The Lord of the Rings: The Return of the King",
    "Fight Club",
    "Forrest Gump",
    "Inception",
    "Interstellar",
    "Parasite",
  ];

  (async () => {
    try {
      const moviePromises = seedTitles.map(async (title) => {
        const search = await searchMoviesByTitle(title, 1);
        if (!search || !search.Search || !search.Search[0]) return null;
        const id = search.Search[0].imdbID;
        const detail = await getMovieDetails(id);
        return transformOmdbData(detail);
      });

      const movies = (await Promise.all(moviePromises)).filter(Boolean);

      if (movies.length === 0) return;

      const filters = getFilters();
      const scored = movies
        .map((m) => ({ ...m, score: calculateScore(m, filters) }))
        .sort((a, b) => b.rating - a.rating || b.score - a.score);

      renderMovies(scored, filters);
    } catch (err) {
      console.error("loadTopRatedOnOpen error:", err);
    }
  })();
}

/* ========== SEARCH & FILTER ========== */

async function applyFilters() {
  const filters = getFilters();
  const searchText = filters.searchText;

  if (isSearching) return;

  if (!searchText || searchText.length < 1) {
    if (moviesGrid) moviesGrid.innerHTML = "";
    if (emptyState) emptyState.hidden = false;
    if (resultsSummary) resultsSummary.textContent = "Type a movie title to search";
    return;
  }

  isSearching = true;
  if (moviesGrid)
    moviesGrid.innerHTML =
      '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-soft); font-size: 16px;">🔍 Searching for "' +
      searchText +
      '"...</div>';
  if (resultsSummary) resultsSummary.textContent = "Fetching movies from OMDb...";

  await searchAndRenderFromOmdb(filters);
  isSearching = false;
}

async function searchAndRenderFromOmdb(filters) {
  try {
    const searchData = await searchMoviesByTitle(filters.searchText, 1);

    if (!searchData || !searchData.Search || searchData.Search.length === 0) {
      if (moviesGrid) moviesGrid.innerHTML = "";
      if (emptyState) emptyState.hidden = false;
      if (resultsSummary) resultsSummary.textContent = `No movies found for "${filters.searchText}"`;
      return;
    }

    const imdbIds = searchData.Search.slice(0, 12).map((item) => item.imdbID);
    const detailedMovies = await batchFetchMovieDetails(imdbIds);

    let movies = (detailedMovies || []).map((detail) => transformOmdbData(detail)).filter(Boolean);

    if (movies.length === 0) {
      if (moviesGrid) moviesGrid.innerHTML = "";
      if (emptyState) emptyState.hidden = false;
      if (resultsSummary) resultsSummary.textContent = "No valid movies found";
      return;
    }

    movies = movies
      .map((m) => ({ ...m, score: calculateScore(m, filters) }))
      .filter((m) => m.rating >= filters.minRating);

    const filtered = movies.filter((m) => {
      if (filters.genre !== "any" && m.genre !== filters.genre) return false;
      if (filters.mood !== "any" && (!m.moods || !m.moods.includes(filters.mood))) return false;
      if (filters.language && filters.language !== "any") {
        if (!m.languages || !m.languages.includes(filters.language)) return false;
      }
      if (showOnlyFavorites && !favorites.has(m.title)) return false;
      if (filters.streamingOnly && m.year < 2000) return false;
      return true;
    });

    filtered.sort((a, b) => {
      switch (filters.sortBy) {
        case "rating-desc":
          return b.rating - a.rating;
        case "year-desc":
          return b.year - a.year;
        case "year-asc":
          return a.year - b.year;
        case "score-desc":
        default:
          return b.score - a.score || b.rating - a.rating;
      }
    });

    renderMovies(filtered, filters);
  } catch (error) {
    console.error("❌ Search error:", error);
    if (moviesGrid) moviesGrid.innerHTML = "";
    if (emptyState) emptyState.hidden = false;
    if (resultsSummary) resultsSummary.textContent = "Error searching. Please try again.";
  }
}

function resetFilters() {
  if (searchInput) searchInput.value = "";
  if (genreSelect) genreSelect.value = "any";
  if (moodSelect) moodSelect.value = "any";
  if (languageSelect) languageSelect.value = "any";
  if (minRatingRange) minRatingRange.value = 7;
  if (minRatingLabel) minRatingLabel.textContent = "7.0+";
  if (streamingOnlyToggle) streamingOnlyToggle.checked = false;
  if (sortSelect) sortSelect.value = "score-desc";
  showOnlyFavorites = false;
  if (favoritesToggleBtn) {
    favoritesToggleBtn.classList.remove("btn-primary");
    favoritesToggleBtn.classList.add("btn-secondary");
    favoritesToggleBtn.textContent = "❤️ Favorites";
  }
  if (moviesGrid) moviesGrid.innerHTML = "";
  if (resultsSummary) resultsSummary.textContent = "Type a movie title to search";
}

/* ========== EVENT LISTENERS ========== */

document.addEventListener("DOMContentLoaded", () => {
  loadFavorites();
  initThemeToggle();
  populateGenres();
  populateLanguages();
// Don't expose API key in client-side code!
// Use Netlify environment variables instead:

const OMDB_API_KEY = process.env.REACT_APP_OMDB_KEY || "265a901b";
  // NEW: Debug API on load
  debugOmdbKey();

  loadTopRatedOnOpen();

  let searchTimeout;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        applyFilters();
      }, 700);
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(searchTimeout);
        applyFilters();
      }
    });
  }

  if (genreSelect) genreSelect.addEventListener("change", applyFilters);
  if (moodSelect) moodSelect.addEventListener("change", applyFilters);
  if (languageSelect) languageSelect.addEventListener("change", applyFilters);

  if (minRatingRange) {
    minRatingRange.addEventListener("input", () => {
      if (minRatingLabel) minRatingLabel.textContent = `${parseFloat(minRatingRange.value).toFixed(1)}+`;
      applyFilters();
    });
  }

  if (streamingOnlyToggle) streamingOnlyToggle.addEventListener("change", applyFilters);
  if (sortSelect) sortSelect.addEventListener("change", applyFilters);

  resetFiltersBtns.forEach((btn) => btn.addEventListener("click", resetFilters));

  if (loadMoreBtn) loadMoreBtn.addEventListener("click", loadMore);

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      if (searchInput) searchInput.focus();
      resetFilters();
    });
  }

  if (favoritesToggleBtn) {
    favoritesToggleBtn.addEventListener("click", () => {
      showOnlyFavorites = !showOnlyFavorites;
      favoritesToggleBtn.classList.toggle("btn-primary", showOnlyFavorites);
      favoritesToggleBtn.classList.toggle("btn-secondary", !showOnlyFavorites);
      favoritesToggleBtn.textContent = showOnlyFavorites ? "❤️ Viewing Favorites" : "❤️ Favorites";
      applyFilters();
    });
  }

  if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeModal);
  if (modalOverlay) modalOverlay.addEventListener("click", closeModal);

  if (modalFavBtn) {
    modalFavBtn.addEventListener("click", () => {
      if (!currentModalMovie) return;
      toggleFavorite(currentModalMovie.title);
    });
  }

  if (movieModal) {
    movieModal.addEventListener("click", (e) => {
      if (e.target === movieModal) closeModal();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && movieModal && movieModal.getAttribute("aria-hidden") === "false") {
      closeModal();
    }
  });

  if (resultsSummary) resultsSummary.textContent = "Type a movie title to search";
});

async function debugOmdbKey() {
  console.log("🧪 Testing OMDb API key...");
  const test = await fetchFromOmdb({ s: "Matrix", type: "movie", page: 1 });
  if (test && test.Search) {
    console.log("✅ OMDb API key WORKS! Found:", test.Search.length, "results");
    return true;
  } else {
    console.error("❌ OMDb API key FAILED. Response:", test);
    return false;
  }
}