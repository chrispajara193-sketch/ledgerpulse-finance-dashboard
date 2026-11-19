/**
 * ==========================================================
 * CONFIGURATION
 * Paste your deployed Google Apps Script Web App URL below.
 * Leave as-is to use built-in localStorage demo persistence.
 * ==========================================================
 */
const GAS_WEB_APP_URL = "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL";
const FX_API_URL = "https://open.er-api.com/v6/latest/USD";

const FX_CACHE_KEY = "ledgerpulse_fx_cache_v1";
const TX_CACHE_KEY = "ledgerpulse_tx_demo_v1";
const THEME_KEY = "ledgerpulse_theme_v1";

// Fallback exchange rates (used only if offline or API unreachable)
const DEFAULT_RATES = {
  USD: 1,
  PHP: 58.5,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 154.0
};

const SEED_TRANSACTIONS = [
  { id: "seed-1", date: "2026-10-05", title: "Monthly Product Retainer", category: "Freelance", type: "income", amount: 1850, currency: "USD" },
  { id: "seed-2", date: "2026-10-12", title: "Apartment Rent", category: "Housing", type: "expense", amount: 24000, currency: "PHP" },
  { id: "seed-3", date: "2026-10-20", title: "Cloud Hosting & Domain", category: "Software", type: "expense", amount: 38, currency: "USD" },
  { id: "seed-4", date: "2026-11-01", title: "Engineering Salary", category: "Salary", type: "income", amount: 3200, currency: "USD" },
  { id: "seed-5", date: "2026-11-04", title: "Weekly Groceries", category: "Food", type: "expense", amount: 4200, currency: "PHP" },
  { id: "seed-6", date: "2026-11-09", title: "Figma & AI Tools", category: "Software", type: "expense", amount: 45, currency: "USD" },
  { id: "seed-7", date: "2026-11-14", title: "Grab & Transit Rides", category: "Transport", type: "expense", amount: 1850, currency: "PHP" },
  { id: "seed-8", date: "2026-11-18", title: "Coffee & Team Lunch", category: "Food", type: "expense", amount: 28, currency: "EUR" }
];

// Application State
const state = {
  transactions: [],
  rates: { ...DEFAULT_RATES },
  displayCurrency: "USD",
  searchQuery: "",
  filterType: "all",
  filterCategory: "all",
  budgetLimit: 2500,
  charts: { cashflow: null, category: null }
};

const isGasConfigured = () =>
  GAS_WEB_APP_URL && GAS_WEB_APP_URL !== "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL";

/* =========================================
   Initialization
========================================= */
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  setDefaultFormDate();
  bindEvents();

  await Promise.all([loadExchangeRates(), loadTransactions()]);
  renderApp();
});

function setDefaultFormDate() {
  document.getElementById("txDate").value = new Date().toISOString().split("T")[0];
}

function bindEvents() {
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);

  document.getElementById("displayCurrency").addEventListener("change", (e) => {
    state.displayCurrency = e.target.value;
    renderApp();
  });

  document.getElementById("budgetInput").addEventListener("input", (e) => {
    const val = Number(e.target.value);
    state.budgetLimit = val > 0 ? val : 1;
    updateKPIs(getFilteredTransactions());
  });

  // Debounced search input
  document.getElementById("searchInput").addEventListener(
    "input",
    debounce((e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      renderApp();
    }, 220)
  );

  document.getElementById("filterType").addEventListener("change", (e) => {
    state.filterType = e.target.value;
    renderApp();
  });

  document.getElementById("filterCategory").addEventListener("change", (e) => {
    state.filterCategory = e.target.value;
    renderApp();
  });

  document.getElementById("txForm").addEventListener("submit", handleAddTransaction);
  document.getElementById("exportCsvBtn").addEventListener("click", exportToCSV);
}

/* =========================================
   External FX API (with 6-Hour Cache)
========================================= */
async function loadExchangeRates() {
  const badge = document.getElementById("fxStatusBadge");
  const updatedEl = document.getElementById("fxUpdatedAt");

  try {
    const cached = JSON.parse(localStorage.getItem(FX_CACHE_KEY) || "null");
    const sixHours = 6 * 60 * 60 * 1000;

    if (cached && Date.now() - cached.timestamp < sixHours) {
      state.rates = cached.rates;
      badge.textContent = "FX API: Cached";
      badge.className = "pill pill-success";
      updatedEl.textContent = `FX rates cached (${new Date(cached.timestamp).toLocaleTimeString()})`;
      return;
    }

    const res = await fetch(FX_API_URL);
    if (!res.ok) throw new Error("FX API unavailable");

    const data = await res.json();
    if (data && data.rates) {
      state.rates = data.rates;
      localStorage.setItem(FX_CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        rates: data.rates
      }));
      badge.textContent = "FX API: Live";
      badge.className = "pill pill-success";
      updatedEl.textContent = `Live FX synced (${new Date().toLocaleTimeString()})`;
    }
  } catch (err) {
    console.warn("Using fallback FX rates:", err);
    badge.textContent = "FX: Offline Rates";
    badge.className = "pill pill-neutral";
    updatedEl.textContent = "Using built-in fallback exchange rates";
  }
}

function convertAmount(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return amount;
  const fromRate = state.rates[fromCurrency] || 1;
  const toRate = state.rates[toCurrency] || 1;
  return (amount / fromRate) * toRate;
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2
  }).format(amount);
}

/* =========================================
   Data Persistence (code.gs or localStorage)
========================================= */
async function loadTransactions() {
  const badge = document.getElementById("storageStatusBadge");

  if (!isGasConfigured()) {
    const saved = localStorage.getItem(TX_CACHE_KEY);
    if (saved) {
      state.transactions = JSON.parse(saved);
    } else {
      state.transactions = [...SEED_TRANSACTIONS];
      localStorage.setItem(TX_CACHE_KEY, JSON.stringify(state.transactions));
    }
    badge.textContent = "Demo Storage";
    badge.className = "pill pill-neutral";
    return;
  }

  try {
    badge.textContent = "Syncing Sheets...";
    const res = await fetch(GAS_WEB_APP_URL);
    const json = await res.json();

    if (json.status === "success") {
      state.transactions = json.data;
      badge.textContent = "Google Sheets Live";
      badge.className = "pill pill-success";
    } else {
      throw new Error(json.message);
    }
  } catch (err) {
    console.error("Failed to fetch from Google Sheets:", err);
    showToast("Could not sync Google Sheets. Showing local data.");
    state.transactions = [...SEED_TRANSACTIONS];
  }
}

async function handleAddTransaction(e) {
  e.preventDefault();
  const submitBtn = document.getElementById("txSubmitBtn");

  const newTx = {
    id: crypto.randomUUID ? crypto.randomUUID() : "tx-" + Date.now(),
    title: document.getElementById("txTitle").value.trim(),
    amount: parseFloat(document.getElementById("txAmount").value),
    currency: document.getElementById("txCurrency").value,
    type: document.getElementById("txType").value,
    category: document.getElementById("txCategory").value,
    date: document.getElementById("txDate").value
  };

  if (!newTx.title || isNaN(newTx.amount) || newTx.amount <= 0) {
    showToast("Please enter a valid description and positive amount.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Saving...";

  try {
    if (isGasConfigured()) {
      const res = await fetch(GAS_WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "add", transaction: newTx })
      });
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.message);
    }

    state.transactions.unshift(newTx);
    if (!isGasConfigured()) {
      localStorage.setItem(TX_CACHE_KEY, JSON.stringify(state.transactions));
    }

    e.target.reset();
    setDefaultFormDate();
    renderApp();
    showToast("Transaction added!");
  } catch (err) {
    console.error(err);
    showToast("Error saving transaction.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "+ Add Transaction";
  }
}

async function deleteTransaction(id) {
  const previous = [...state.transactions];
  state.transactions = state.transactions.filter((tx) => tx.id !== id);
  renderApp();

  try {
    if (isGasConfigured()) {
      const res = await fetch(GAS_WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "delete", id })
      });
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.message);
    } else {
      localStorage.setItem(TX_CACHE_KEY, JSON.stringify(state.transactions));
    }
    showToast("Transaction removed.");
  } catch (err) {
    state.transactions = previous;
    renderApp();
    showToast("Failed to delete from Google Sheets.");
  }
}

/* =========================================
   Rendering (KPIs, Table, Charts)
========================================= */
function getFilteredTransactions() {
  return state.transactions
    .filter((tx) => {
      const matchesSearch = tx.title.toLowerCase().includes(state.searchQuery);
      const matchesType = state.filterType === "all" || tx.type === state.filterType;
      const matchesCat = state.filterCategory === "all" || tx.category === state.filterCategory;
      return matchesSearch && matchesType && matchesCat;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function renderApp() {
  const filtered = getFilteredTransactions();
  updateKPIs(filtered);
  renderTable(filtered);
  renderCharts(filtered);
}

function updateKPIs(transactions) {
  let income = 0;
  let expenses = 0;

  transactions.forEach((tx) => {
    const val = convertAmount(tx.amount, tx.currency, state.displayCurrency);
    if (tx.type === "income") income += val;
    else expenses += val;
  });

  const balance = income - expenses;
  const pct = Math.min(Math.round((expenses / state.budgetLimit) * 100), 100);

  document.getElementById("kpiBalance").textContent = formatMoney(balance, state.displayCurrency);
  document.getElementById("kpiIncome").textContent = formatMoney(income, state.displayCurrency);
  document.getElementById("kpiExpenses").textContent = formatMoney(expenses, state.displayCurrency);
  document.getElementById("budgetText").textContent = `${pct}% used`;

  const bar = document.getElementById("budgetProgressBar");
  bar.style.width = `${pct}%`;
  bar.style.background = pct >= 90 ? "var(--danger)" : pct >= 70 ? "var(--warning)" : "var(--primary)";
}

function renderTable(transactions) {
  const tbody = document.getElementById("txTableBody");
  const emptyState = document.getElementById("emptyState");
  document.getElementById("txCount").textContent = transactions.length;

  tbody.innerHTML = "";
  if (transactions.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  transactions.forEach((tx) => {
    const converted = convertAmount(tx.amount, tx.currency, state.displayCurrency);
    const isPositive = tx.type === "income";
    const sign = isPositive ? "+" : "-";
    const colorClass = isPositive ? "text-success" : "text-danger";

    const origNote =
      tx.currency !== state.displayCurrency
        ? `<span class="orig-amt">Orig: ${formatMoney(tx.amount, tx.currency)}</span>`
        : "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="tabular">${escapeHtml(tx.date)}</td>
      <td><strong>${escapeHtml(tx.title)}</strong></td>
      <td><span class="cat-badge">${escapeHtml(tx.category)}</span></td>
      <td class="text-right tabular ${colorClass}">
        <strong>${sign}${formatMoney(converted, state.displayCurrency)}</strong>
        ${origNote}
      </td>
      <td class="text-center">
        <button class="btn-delete" aria-label="Delete transaction" title="Delete">🗑️</button>
      </td>
    `;

    tr.querySelector(".btn-delete").addEventListener("click", () => deleteTransaction(tx.id));
    tbody.appendChild(tr);
  });
}

function renderCharts(transactions) {
  if (typeof Chart === "undefined") return;

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const textColor = isDark ? "#94a3b8" : "#64748b";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)";

  // 1. Aggregate Monthly Cashflow
  const monthlyMap = {};
  transactions.forEach((tx) => {
    const monthKey = tx.date.slice(0, 7); // YYYY-MM
    if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { income: 0, expense: 0 };
    const val = convertAmount(tx.amount, tx.currency, state.displayCurrency);
    monthlyMap[monthKey][tx.type] += val;
  });

  const sortedMonths = Object.keys(monthlyMap).sort();
  const incomeSeries = sortedMonths.map((m) => Number(monthlyMap[m].income.toFixed(2)));
  const expenseSeries = sortedMonths.map((m) => Number(monthlyMap[m].expense.toFixed(2)));

  if (state.charts.cashflow) state.charts.cashflow.destroy();
  state.charts.cashflow = new Chart(document.getElementById("cashflowChart"), {
    type: "bar",
    data: {
      labels: sortedMonths,
      datasets: [
        { label: "Income", data: incomeSeries, backgroundColor: "#10b981", borderRadius: 6 },
        { label: "Expenses", data: expenseSeries, backgroundColor: "#ef4444", borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: textColor } } },
      scales: {
        x: { ticks: { color: textColor }, grid: { display: false } },
        y: { ticks: { color: textColor }, grid: { color: gridColor } }
      }
    }
  });

  // 2. Aggregate Expense Categories
  const catMap = {};
  transactions
    .filter((tx) => tx.type === "expense")
    .forEach((tx) => {
      const val = convertAmount(tx.amount, tx.currency, state.displayCurrency);
      catMap[tx.category] = (catMap[tx.category] || 0) + val;
    });

  if (state.charts.category) state.charts.category.destroy();
  state.charts.category = new Chart(document.getElementById("categoryChart"), {
    type: "doughnut",
    data: {
      labels: Object.keys(catMap),
      datasets: [
        {
          data: Object.values(catMap).map((v) => Number(v.toFixed(2))),
          backgroundColor: ["#4f46e5", "#06b6d4", "#f59e0b", "#ec4899", "#8b5cf6", "#10b981"],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "66%",
      plugins: {
        legend: { position: "bottom", labels: { color: textColor, boxWidth: 12 } }
      }
    }
  });
}

/* =========================================
   Utilities: CSV Export, Theme, Toast, Security
========================================= */
function exportToCSV() {
  const rows = getFilteredTransactions();
  if (rows.length === 0) {
    showToast("No transactions to export.");
    return;
  }

  const headers = ["Date", "Description", "Category", "Type", "Original Amount", "Original Currency", `Converted (${state.displayCurrency})`];
  const csvLines = [
    headers.join(","),
    ...rows.map((tx) => {
      const converted = convertAmount(tx.amount, tx.currency, state.displayCurrency).toFixed(2);
      return [
        tx.date,
        `"${tx.title.replace(/"/g, '""')}"`,
        tx.category,
        tx.type,
        tx.amount,
        tx.currency,
        converted
      ].join(",");
    })
  ];

  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ledgerpulse-export-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("CSV downloaded!");
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "light";
  document.documentElement.setAttribute("data-theme", saved);
  document.getElementById("themeToggle").textContent = saved === "dark" ? "☀️" : "🌙";
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  document.getElementById("themeToggle").textContent = next === "dark" ? "☀️" : "🌙";
  renderCharts(getFilteredTransactions());
}

function showToast(message) {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
