/* ============================================================================
 * script.js — DreamBuilders Landing Page
 * ----------------------------------------------------------------------------
 * Файл:      script.js
 * Проект:    Одностраничный лендинг языкового центра DreamBuilders (г. Актобе)
 * Назначение: Вся клиентская логика страницы.
 *
 * Содержание (порядок в файле):
 *  1. Вспомогательные функции ($ и $$) — сокращённый поиск DOM-элементов.
 *  2. Текущий год в футере — подстановка <span id="year">.
 *  3. Прогресс-бар прокрутки + кнопка "наверх" (to-top).
 *  4. Мобильное меню (бургер): открытие/закрытие, автозакрытие по клику на ссылку.
 *  5. Плавное появление блоков при прокрутке (IntersectionObserver + .reveal).
 *  6. Аккордеон FAQ (открытие одного вопроса за раз).
 *  7. Подстановка выбранной программы в форму при клике на тарифы/чипы.
 *  8. Маска телефона формата KZ: +7 (___) ___-__-__.
 *  9. Валидация формы (имя, телефон, направление, согласие).
 * 10. Отправка заявки: сохранение в localStorage + письмо через mailto:.
 *
 * Требования: разметка index.html (семантические id/class совпадают со скриптом).
 * Зависимости: отсутствуют (чистый JS, без библиотек).
 * ========================================================================== */

// ---- 1. Вспомогательные функции ------------------------------------------------
// $   — возвращает первый найденный элемент по селектору.
// $$  — возвращает массив (spread) всех найденных элементов.
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

// ---- 2. Текущий год в футере ---------------------------------------------------
// Динамически вписывает текущий год в элемент <span id="year"> (© 2026 ...).
const yearEl = $('#year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// ---- 3. Прогресс-бар + кнопка "наверх" ----------------------------------------
// header   — «прилипшая» шапка (визуальных изменений не требует, оставлен для расширения).
// progress — полоса прогресса прокрутки сверху (ширина = % прокрученной страницы).
// toTop    — кнопка возврата наверх, появляется после 600px прокрутки.
const header = $('#header'), progress = $('#scrollProgress'), toTop = $('#toTop');
const onScroll = () => {
  const y = window.scrollY;
  // Процент прокрутки = текущая позиция / (высота всей страницы - высота экрана)
  if (progress) progress.style.width = (y / (document.documentElement.scrollHeight - innerHeight)) * 100 + '%';
  // Показываем кнопку "наверх", только когда пользователь далеко внизу
  toTop?.classList.toggle('is-show', y > 600);
};
// passive: true — сигнализируем браузеру, что не будем preventDefault (ускоряет скролл)
addEventListener('scroll', onScroll, { passive: true });
onScroll(); // первичный расчёт при загрузке
toTop?.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

// ---- 4. Мобильное меню (бургер) ------------------------------------------------
const burger = $('#burger'), nav = $('#nav');
// Закрывает меню и сбрасывает aria-expanded (важно для доступности/скринридеров)
const closeNav = () => { nav.classList.remove('is-open'); burger.setAttribute('aria-expanded', 'false'); };
burger?.addEventListener('click', () => {
  const open = nav.classList.toggle('is-open');
  burger.setAttribute('aria-expanded', String(open));
});
// Автозакрытие после перехода по пункту меню (удобно на мобильных)
nav?.addEventListener('click', (e) => { if (e.target.tagName === 'A') closeNav(); });

// ---- 5. Плавное появление блоков при прокрутке (.reveal) ----------------------
// Каждый элемент .reveal получает класс .is-in, когда попадает в зону видимости.
// Атрибут data-delay (мс) задаёт каскад — элементы выезжают с небольшим интервалом.
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => {
      if (!e.isIntersecting) return;
      const d = e.target.dataset.delay;
      if (d) e.target.style.transitionDelay = d + 'ms';
      e.target.classList.add('is-in');
      io.unobserve(e.target); // отключаем наблюдение — анимация нужна лишь один раз
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px' });
  $$('.reveal').forEach((el) => io.observe(el));
} else {
  // Фолбэк для старых браузеров без IntersectionObserver — сразу показываем всё
  $$('.reveal').forEach((el) => el.classList.add('is-in'));
}

// ---- 6. Аккордеон FAQ ----------------------------------------------------------
// Логика: открытие одного вопроса автоматически закрывает остальные.
// Высота раскрывается через inline paddingBottom (переход анимируется через grid-rows в CSS).
$$('.faq__item').forEach((item) => {
  const q = $('.faq__q', item), body = $('.faq__a > div', item);
  q.addEventListener('click', () => {
    const willOpen = !item.classList.contains('is-open');
    // Зрываем все ранее открытые
    $$('.faq__item.is-open').forEach((o) => {
      o.classList.remove('is-open');
      o.querySelector('.faq__q').setAttribute('aria-expanded', 'false');
      $('.faq__a > div', o).style.paddingBottom = '0';
    });
    // Открываем текущий (если он был закрыт)
    if (willOpen) {
      item.classList.add('is-open');
      q.setAttribute('aria-expanded', 'true');
      body.style.paddingBottom = '22px';
    }
  });
});

// ---- 7. Подстановка программы в форму -----------------------------------------
// Кнопки "Выбрать" на карточках тарифов имеют data-course="...",
// поэтому клик по тарифу заранее выбирает нужный пункт в <select> формы.
const sel = $('#course');
$$('[data-course]').forEach((a) => a.addEventListener('click', () => { if (sel) sel.value = a.dataset.course; }));

// ---- 7b. WhatsApp: авто-подстановка текста сообщения -------------------------
// Кнопки #waFormBtn и #waFloat ведут на wa.me/номер с готовым текстом:
//   "Здравствуйте! Хочу на бесплатный пробный урок DreamBuilders на программу «...»"
// Программа берётся из <select id="course">, имя — из поля, если заполнено.
const waFormBtn = $('#waFormBtn'), waFloat = $('#waFloat');
const buildWaMessage = () => {
  const course = (sel && sel.value) ? sel.value : 'Подготовка к IELTS';
  // Опрашиваем поле имени напрямую — nameEl объявляется ниже (избегаем TDZ)
  const name = ($('#name')?.value || '').trim();
  let msg = `Здравствуйте! Хочу на бесплатный пробный урок DreamBuilders на программу «${course}»`;
  if (name) msg += `. Меня зовут ${name}`;
  return msg + '.';
};
// Собираем wa.me-ссылку и обновляем href обеих кнопок
const updateWaLinks = () => {
  const url = 'https://wa.me/77071215457?text=' + encodeURIComponent(buildWaMessage());
  if (waFormBtn) waFormBtn.href = url;
  if (waFloat) waFloat.href = url;
};
// Обновляем при смене программы/имени и перед переходом (на всякий случай)
sel?.addEventListener('change', updateWaLinks);
$('#name')?.addEventListener('input', updateWaLinks);
waFormBtn?.addEventListener('click', updateWaLinks);
waFloat?.addEventListener('click', updateWaLinks);
updateWaLinks(); // стартовое состояние: программа по умолчанию — IELTS

// ---- 8. Маска телефона (формат Казахстана) -------------------------------------
// Приводит ввод к виду: +7 (XXX) XXX-XX-XX (итого 11 цифр, первая всегда 7).
// "8" в начале автоматически заменяется на "7".
const phone = $('#phone');
phone?.addEventListener('input', () => {
  let d = phone.value.replace(/\D/g, '');   // оставляем только цифры
  if (d.startsWith('8')) d = '7' + d.slice(1); // локальный формат 8... -> 7...
  if (d && !d.startsWith('7')) d = '7' + d;    // если не начало с 7 — дописываем 7
  d = d.slice(0, 11);                          // максимум 11 цифр
  let out = '';
  if (d.length > 0) out = '+7';
  if (d.length > 1) out += ' (' + d.slice(1, 4);
  if (d.length >= 4) out += ') ' + d.slice(4, 7);
  if (d.length >= 7) out += '-' + d.slice(7, 9);
  if (d.length >= 9) out += '-' + d.slice(9, 11);
  phone.value = out;
});

// ---- 9. Валидация формы --------------------------------------------------------
const nameEl = $('#name'), agree = $('#agree'), checkWrap = $('#checkWrap');
// bad() — помечает поле ошибкой (добавляет класс .is-bad к обёртке .field)
const bad = (el, v) => el.closest('.field').classList.toggle('is-bad', v);
// Сбрасываем ошибки при начале исправления
nameEl?.addEventListener('input', () => bad(nameEl, false));
phone?.addEventListener('input', () => bad(phone, false));
sel?.addEventListener('change', () => bad(sel, false));
agree?.addEventListener('change', () => checkWrap.classList.remove('is-bad'));

// ---- 10. Отправка заявки -------------------------------------------------------
const form = $('#trialForm');
form?.addEventListener('submit', (e) => {
  e.preventDefault(); // отменяем нативную отправку — обрабатываем сами
  let ok = true;

  // Проверяем каждое обязательное поле
  if (!nameEl.value.trim()) { bad(nameEl, true); ok = false; }                 // имя непустое
  if (phone.value.replace(/\D/g, '').length < 11) { bad(phone, true); ok = false; } // 11 цифр телефона
  if (!sel.value) { bad(sel, true); ok = false; }                              // выбрано направление
  if (!agree.checked) { checkWrap.classList.add('is-bad'); ok = false; }       // дано согласие

  // Если есть ошибки — прокручиваем к первому проблемному полю
  if (!ok) { form.querySelector('.is-bad')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }

  // Блокируем кнопку на время «отправки» (имитация сети)
  const btn = $('#submitBtn');
  btn.disabled = true;
  btn.textContent = 'Отправляем…';

  // Данные заявки (сохраняются локально + уходят письмом)
  const data = {
    name: nameEl.value.trim(),
    phone: phone.value.trim(),
    course: sel.value,
    comment: $('#comment').value.trim(),
    createdAt: new Date().toISOString(),
  };

  // Хранилище заявок в localStorage (демо-режим без бэкенда).
  // Для боевой эксплуатации заменить на fetch() к API/Formspree/Web3Forms.
  try {
    const all = JSON.parse(localStorage.getItem('db_requests') || '[]');
    all.push(data);
    localStorage.setItem('db_requests', JSON.stringify(all));
  } catch (_) { /* при ошибке хранилища просто игнорируем */ }

  setTimeout(() => {
    $('#formDone').hidden = false;   // показываем экран «Заявка принята»
    btn.disabled = false;
    btn.textContent = 'Отправить заявку';
    form.reset();                    // очищаем поля
    // Открываем почтовый клиент с готовым письмом (запасной канал доставки)
    const subject = encodeURIComponent('Заявка на пробный урок — DreamBuilders');
    const body = encodeURIComponent(`Имя: ${data.name}\nТелефон: ${data.phone}\nПрограмма: ${data.course}\nКомментарий: ${data.comment || '—'}`);
    setTimeout(() => { location.href = `mailto:dreambuilders.edu@gmail.com?subject=${subject}&body=${body}`; }, 800);
  }, 600);
});

// Закрытие экрана успеха
$('#doneClose')?.addEventListener('click', () => { $('#formDone').hidden = true; });
