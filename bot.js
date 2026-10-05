import { Bot, InlineKeyboard } from "grammy";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN topilmadi. .env faylga BOT_TOKEN=... yozing.");
  process.exit(1);
}

const bot = new Bot(token);

// --- Holat (xotirada saqlanadi) ---
const DEFAULT_CITY = { name: "Toshkent", lat: 41.2995, lon: 69.2401 };
const cities = new Map(); // userId -> { name, lat, lon }
const waitingCity = new Set(); // shahar nomini kutayotgan userlar

const getCity = (id) => cities.get(id) ?? DEFAULT_CITY;

// --- Matnlar ---
const MONTHS = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "Iyun",
  "Iyul",
  "Avgust",
  "Sentyabr",
  "Oktyabr",
  "Noyabr",
  "Dekabr",
];
const WEEKDAYS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

function describeWeather(code) {
  if (code === 0) return "☀️ Ochiq osmon";
  if (code <= 3) return "⛅️ Qisman bulutli";
  if (code <= 48) return "🌫 Tuman";
  if (code <= 57) return "🌦 Mayda yomg'ir";
  if (code <= 67) return "🌧 Yomg'ir";
  if (code <= 77) return "❄️ Qor";
  if (code <= 82) return "🌧 Jala";
  if (code <= 86) return "🌨 Qor jalasi";
  return "⛈ Momaqaldiroq";
}

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`; // m: 0-11
const todayISO = () => new Date().toISOString().slice(0, 10);

// --- Kalendar ---
function buildCalendar(year, month, city) {
  const prev = month === 0 ? [year - 1, 11] : [year, month - 1];
  const next = month === 11 ? [year + 1, 0] : [year, month + 1];

  const kb = new InlineKeyboard()
    .text("◀️", `m:${prev[0]}-${pad(prev[1] + 1)}`)
    .text(`${MONTHS[month]} ${year}`, "noop")
    .text("▶️", `m:${next[0]}-${pad(next[1] + 1)}`)
    .row();

  WEEKDAYS.forEach((d) => kb.text(d, "noop"));
  kb.row();

  const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // Dushanba = 0
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = todayISO();

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push({ text: " ", data: "noop" });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = iso(year, month, d);
    cells.push({
      text: date === today ? `${d}•` : String(d),
      data: `d:${date}`,
    });
  }
  while (cells.length % 7 !== 0) cells.push({ text: " ", data: "noop" });

  cells.forEach((c, i) => {
    kb.text(c.text, c.data);
    if ((i + 1) % 7 === 0) kb.row();
  });

  kb.text(`📍 ${city.name} (o'zgartirish)`, "city");
  return kb;
}

// --- Open-Meteo ---
async function searchCity(query) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name: query, count: "1", language: "en" });
  const res = await fetch(url);
  if (!res.ok) throw new Error("Geocoding xatosi");
  const data = await res.json();
  const r = data.results?.[0];
  if (!r) return null;
  return { name: r.name, lat: r.latitude, lon: r.longitude };
}

async function fetchWeather(city, date) {
  const diffDays = Math.round(
    (Date.parse(date) - Date.parse(todayISO())) / 864e5
  );
  if (diffDays > 15) return { error: "Prognoz faqat 16 kun oldinga mavjud." };

  // Eski sanalar uchun arxiv API, qolganlari uchun forecast API
  const base =
    diffDays < -7
      ? "https://archive-api.open-meteo.com/v1/archive"
      : "https://api.open-meteo.com/v1/forecast";

  const url = new URL(base);
  url.search = new URLSearchParams({
    latitude: city.lat,
    longitude: city.lon,
    start_date: date,
    end_date: date,
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max",
    timezone: "auto",
  });

  const res = await fetch(url);
  if (!res.ok) return { error: "Ob-havo ma'lumotini olib bo'lmadi." };
  const d = (await res.json()).daily;
  if (!d || d.time.length === 0 || d.temperature_2m_max[0] == null) {
    return { error: "Bu sana uchun ma'lumot yo'q." };
  }
  return {
    code: d.weather_code[0],
    max: d.temperature_2m_max[0],
    min: d.temperature_2m_min[0],
    rain: d.precipitation_sum[0],
    wind: d.wind_speed_10m_max[0],
  };
}

// --- Handlerlar ---
function calendarText(city) {
  return `📍 <b>${city.name}</b>\nSanani tanlang:`;
}

async function showCalendar(ctx) {
  const city = getCity(ctx.from.id);
  const now = new Date();
  await ctx.reply(calendarText(city), {
    parse_mode: "HTML",
    reply_markup: buildCalendar(now.getUTCFullYear(), now.getUTCMonth(), city),
  });
}

async function askCity(ctx) {
  waitingCity.add(ctx.from.id);
  await ctx.reply(
    "Shahar nomini yozing (masalan: Samarqand, London, Istanbul):"
  );
}

bot.command("start", async (ctx) => {
  waitingCity.delete(ctx.from.id);
  await showCalendar(ctx);
});

bot.command("city", askCity);

bot.callbackQuery("noop", (ctx) => ctx.answerCallbackQuery());

bot.callbackQuery("city", async (ctx) => {
  await ctx.answerCallbackQuery();
  await askCity(ctx);
});

// Oy almashtirish
bot.callbackQuery(/^m:(\d{4})-(\d{2})$/, async (ctx) => {
  const year = Number(ctx.match[1]);
  const month = Number(ctx.match[2]) - 1;
  const city = getCity(ctx.from.id);
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({
    reply_markup: buildCalendar(year, month, city),
  });
});

// Sana tanlandi -> pogoda
bot.callbackQuery(/^d:(\d{4})-(\d{2})-(\d{2})$/, async (ctx) => {
  const [, y, m, d] = ctx.match;
  const date = `${y}-${m}-${d}`;
  const city = getCity(ctx.from.id);
  await ctx.answerCallbackQuery();

  let text;
  try {
    const w = await fetchWeather(city, date);
    if (w.error) {
      text = `📍 <b>${city.name}</b> — ${d}.${m}.${y}\n\n⚠️ ${w.error}`;
    } else {
      text =
        `📍 <b>${city.name}</b> — ${d}.${m}.${y}\n\n` +
        `${describeWeather(w.code)}\n` +
        `🌡 Harorat: ${Math.round(w.min)}° ... ${Math.round(w.max)}°C\n` +
        `🌧 Yog'in: ${w.rain} mm\n` +
        `💨 Shamol: ${Math.round(w.wind)} km/soat`;
    }
  } catch (err) {
    console.error(err);
    text = "⚠️ Xatolik yuz berdi, keyinroq urinib ko'ring.";
  }

  try {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: buildCalendar(Number(y), Number(m) - 1, city),
    });
  } catch (err) {
    // Bir xil sana qayta bosilsa Telegram "message is not modified" qaytaradi
    if (!String(err.description ?? err).includes("not modified")) throw err;
  }
});

// Foydalanuvchi shahar nomini yozdi
bot.on("message:text", async (ctx) => {
  if (!waitingCity.has(ctx.from.id)) {
    return ctx.reply("Boshlash uchun /start bosing.");
  }
  try {
    const city = await searchCity(ctx.message.text.trim());
    if (!city)
      return ctx.reply("Bunday shahar topilmadi. Boshqa nom yozib ko'ring:");
    cities.set(ctx.from.id, city);
    waitingCity.delete(ctx.from.id);
    await showCalendar(ctx);
  } catch (err) {
    console.error(err);
    await ctx.reply("Shaharni qidirishda xatolik. Qayta urinib ko'ring:");
  }
});

bot.catch((err) => console.error("Bot xatosi:", err.error ?? err));

bot.api.setMyCommands([
  { command: "start", description: "Kalendarni ochish" },
  { command: "city", description: "Shaharni o'zgartirish" },
]);

bot.start();
console.log("Bot ishga tushdi...");
