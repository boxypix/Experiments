// tree.data.js
// Данные "дерева метрик" + описания.
// Правило: один узел = одна метрика/группа. Узлы-группы тоже можно описывать (как смысл ветки).

const METRIC_TREE = {
  id: "root",
  code: "TREE",
  name: "Дерево метрик (B2C)",
  short: "Единая структура метрик: NSM → Acquisition → Activation → Engagement → Retention → Monetization + Quality + Unit economics.",
  why: "Помогает связать продуктовую ценность (NSM) с драйверами роста и найти точку, где ломается воронка/качество/экономика.",
  tags: ["framework", "b2c"],
  howImprove: [
    "Определи NSM под конкретный продукт (не 'MAU')",
    "Повесь на каждую ветку 1–2 ведущих метрики (leading) и 1–2 итоговых (lagging)",
    "Делай срезы по когортам: канал/страна/версия/пейволл/сегмент"
  ],
  pitfalls: [
    "Пытаться оптимизировать всё сразу — метрики начнут конфликтовать",
    "Подменять ценность 'временем в приложении' или 'кол-вом экранов'",
    "Смешивать платный и органический трафик без когорт"
  ],
  related: ["NSM", "D7", "LTV", "CAC"],
  children: [
    {
      id: "nsm",
      code: "NSM",
      name: "North Star Metric (NSM)",
      short: "Одна метрика, которая лучше всего отражает полученную пользователем ценность.",
      why: "Фокусирует команду на value, а не на суетных прокси (трафик/просмотры).",
      formula: "NSM = users_with_core_value_event_per_period (например, weekly users who completed core action)",
      tags: ["strategy", "value"],
      howImprove: [
        "Определи core value event (1–2 события максимум)",
        "Уменьши Time to Value (TTV) и трение в первых шагах",
        "Увеличивай частоту core action и возвраты (retention)",
        "Убирай деградации качества (crash/latency)"
      ],
      pitfalls: [
        "Выбрать NSM = MAU/DAU (это размер, а не ценность)",
        "Выбрать действие, которое легко накрутить (vanity)",
        "Не зафиксировать период и правило подсчёта"
      ],
      related: ["AHA", "TTV", "CoreActionFreq", "D7"]
    },

    {
      id: "acq",
      code: "ACQ",
      name: "Acquisition (Привлечение)",
      short: "Как пользователи узнают о продукте и доходят до установки/регистрации.",
      why: "Определяет масштаб верхней воронки и качество входящего потока.",
      tags: ["growth", "marketing"],
      howImprove: [
        "ASO/SEO, локализация, скриншоты/видео",
        "Тест креативов и сегментов",
        "Стабильный микс каналов (не зависеть от одного)"
      ],
      pitfalls: [
        "Сравнивать каналы без нормализации по когортам и качеству",
        "Оптимизировать CPI в ущерб retention (дешёвый трафик = мёртвый)"
      ],
      children: [
        {
          id: "impr",
          code: "Impressions",
          name: "Impressions / Reach",
          short: "Сколько людей увидели продукт/креатив/страницу.",
          why: "Без масштаба вверху воронки нечего оптимизировать ниже.",
          formula: "Impressions = count(ad_impressions) или store_page_impressions",
          tags: ["top-funnel"],
          howImprove: ["Расширять охват каналов", "Улучшать ASO/SEO", "Партнёрки/рефералки/PR"],
          pitfalls: ["Рост показов без CTR/CVR — пустая метрика"],
          related: ["CTR", "CVR_Install"]
        },
        {
          id: "ctr",
          code: "CTR",
          name: "CTR (Click-through rate)",
          short: "Клики / показы.",
          why: "Сигнал качества сообщения и попадания в аудиторию.",
          formula: "CTR = clicks / impressions",
          tags: ["top-funnel"],
          howImprove: ["Тестировать офферы и креативы", "Сегментировать аудиторию", "Сильный first frame (видео/скрин)"],
          pitfalls: ["Высокий CTR с низким CVR — кликбейт/не тот оффер"],
          related: ["CVR_Install", "CPI"]
        },
        {
          id: "cvr_install",
          code: "CVR_Install",
          name: "Install Conversion Rate",
          short: "Установки / визиты в стор или лендинг.",
          why: "Насколько страница продукта продаёт обещание.",
          formula: "CVR_Install = installs / store_page_visits",
          tags: ["store", "landing"],
          howImprove: ["Скриншоты: боль→выгода", "Видео демо ценности", "Локализация, социальное доказательство"],
          pitfalls: ["Менять страницу без A/B и без контроля сезона/канала"],
          related: ["Rating", "Reviews", "CPI"]
        },
        {
          id: "cpi",
          code: "CPI/CPA",
          name: "CPI / CPA",
          short: "Стоимость установки или целевого действия.",
          why: "Понимание масштабируемости маркетинга.",
          formula: "CPI = spend / installs; CPA = spend / target_actions",
          tags: ["unit-econ", "ads"],
          howImprove: ["События оптимизации ближе к value", "Отключать слабые сегменты", "Качество onboarding/retention"],
          pitfalls: ["Оптимизировать CPI без LTV и retention"],
          related: ["LTV", "CAC", "Payback"]
        },
        {
          id: "channel_mix",
          code: "ChannelMix",
          name: "Channel Mix",
          short: "Доля каналов (органика/платка/реферал/PR).",
          why: "Снижает риск зависимости от одного источника.",
          tags: ["strategy"],
          howImprove: ["Растить органику", "Запускать рефералки", "Контент и PR"],
          pitfalls: ["Смешивать органику с платкой в одном графике без разделения когорт"],
          related: ["Impressions", "CPI/CPA"]
        }
      ]
    },

    {
      id: "act",
      code: "ACT",
      name: "Activation (Активация / First Value)",
      short: "Получил ли новый пользователь первую реальную пользу и насколько быстро.",
      why: "Activation — главный драйвер retention: без first value пользователь не вернётся.",
      tags: ["onboarding", "aha"],
      howImprove: ["Сокращать Time to Value", "Убирать обязательную регистрацию", "Дефолты и шаблоны"],
      pitfalls: ["Считать completion онбординга вместо 'получил value'"],
      children: [
        {
          id: "aha",
          code: "AHA",
          name: "Activation Rate (Aha-rate)",
          short: "% новых пользователей, совершивших 'первое ценностное действие' в первые X минут/дней.",
          why: "Если Aha низкий — дальше любые улучшения монетизации бесполезны.",
          formula: "AHA = new_users_with_value_event_in_X / new_users",
          tags: ["leading"],
          howImprove: ["Определить value-event", "Срезать шаги до value", "Сделать демо/превью ценности до логина"],
          pitfalls: ["Value-event выбран слишком легким или не связан с ценностью"],
          related: ["TTV", "D1", "OnboardingCompletion"]
        },
        {
          id: "ttv",
          code: "TTV",
          name: "Time to Value (TTV)",
          short: "Время до первого полезного результата.",
          why: "Чем дольше TTV — тем выше ранний отвал.",
          formula: "TTV = time(value_event) - time(first_open)",
          tags: ["onboarding", "ux"],
          howImprove: ["Гостевой режим", "Автозаполнение", "Шаблоны", "Сократить permissions до момента пользы"],
          pitfalls: ["Считать время до регистрации вместо времени до value"],
          related: ["AHA", "D1"]
        },
        {
          id: "onb",
          code: "OnbCompletion",
          name: "Onboarding Completion",
          short: "% завершивших онбординг.",
          why: "Показывает трение в первых шагах (но это прокси, не цель).",
          formula: "OnbCompletion = users_completed_onboarding / new_users",
          tags: ["proxy"],
          howImprove: ["Резать шаги", "Прогрессивный онбординг", "Больше дефолтов"],
          pitfalls: ["Оптимизировать completion ценой качества (люди проходят, но не получают value)"],
          related: ["AHA", "TTV"]
        },
        {
          id: "perm",
          code: "OptIn",
          name: "Permission Opt-in Rate",
          short: "% согласившихся на разрешения (push/location/health).",
          why: "Влияет на ключевые фичи и коммуникации (особенно push).",
          formula: "OptIn = users_granted_permission / users_prompted",
          tags: ["push", "privacy"],
          howImprove: ["Просить just-in-time", "Объяснять выгоду", "Дать альтернативу без пермишена"],
          pitfalls: ["Просить разрешение в первые секунды без контекста"],
          related: ["PushOpenRate", "D7"]
        }
      ]
    },

    {
      id: "eng",
      code: "ENG",
      name: "Engagement (Использование)",
      short: "Как часто и насколько глубоко люди используют продукт.",
      why: "Engagement = привычка/повторяемость ценности; без него retention проседает.",
      tags: ["usage"],
      howImprove: ["Поводы вернуться", "Персонализация", "Улучшать discoverability фич"],
      pitfalls: ["Считать 'время в приложении' как успех"],
      children: [
        {
          id: "dau",
          code: "DAU/WAU/MAU",
          name: "DAU / WAU / MAU",
          short: "Активные пользователи за день/неделю/месяц.",
          why: "Размер активной базы (лагирующий индикатор).",
          formula: "DAU = distinct users with any session per day",
          tags: ["volume"],
          howImprove: ["Улучшать retention", "Поводы вернуться", "Сегментация и win-back"],
          pitfalls: ["Рост DAU без NSM/core action — мнимая активность"],
          related: ["Stickiness", "CoreActionFreq"]
        },
        {
          id: "stick",
          code: "Stickiness",
          name: "Stickiness (DAU/MAU или WAU/MAU)",
          short: "Доля месячной аудитории, которая активна каждый день/неделю.",
          why: "Понимаешь: продукт — привычка или редкая нужда.",
          formula: "Stickiness = DAU/MAU (или WAU/MAU)",
          tags: ["habit"],
          howImprove: ["Регулярные сценарии", "Контент/триггеры", "Стабильные циклы ценности"],
          pitfalls: ["Сравнивать разные категории продуктов по одному порогу stickiness"],
          related: ["DAU/WAU/MAU", "Retention"]
        },
        {
          id: "sess_u",
          code: "SessionsPerUser",
          name: "Sessions per user",
          short: "Сколько сессий на пользователя за период.",
          why: "Прокси частоты использования (лучше вместе с core action).",
          formula: "SessionsPerUser = sessions / active_users",
          tags: ["frequency"],
          howImprove: ["Ускорить ключевые сценарии", "Сделать повторяемые задачи проще", "Внятные entry points"],
          pitfalls: ["Сессии растут из-за багов/фрустрации (люди 'переоткрывают')"],
          related: ["CoreActionFreq", "Latency"]
        },
        {
          id: "feat_adopt",
          code: "FeatureAdoption",
          name: "Feature Adoption",
          short: "Доля пользователей, использующих конкретную фичу.",
          why: "Понимаешь, что реально работает, а что мёртвое.",
          formula: "FeatureAdoption = users_used_feature / active_users",
          tags: ["feature"],
          howImprove: ["Discoverability", "Контекстные подсказки", "Умные дефолты"],
          pitfalls: ["Давить подсказками/баннерами и портить UX"],
          related: ["AHA", "CoreActionFreq"]
        },
        {
          id: "core_freq",
          code: "CoreActionFreq",
          name: "Core Action Frequency",
          short: "Сколько раз пользователь делает ключевое действие за период.",
          why: "Ближе всего к ценности и NSM.",
          formula: "CoreActionFreq = core_actions / active_users (per week/month)",
          tags: ["value", "leading"],
          howImprove: ["Снизить трение", "Сделать быстрые повторения", "Персональные сценарии"],
          pitfalls: ["Выбрать не то 'core action' и оптимизировать шум"],
          related: ["NSM", "D7"]
        }
      ]
    },

    {
      id: "ret",
      code: "RET",
      name: "Retention (Удержание)",
      short: "Возвращаются ли пользователи и остаются ли они активными по когортам.",
      why: "Если retention слабый — рост всегда будет 'дырявым ведром'.",
      tags: ["cohorts"],
      howImprove: ["Улучшать activation", "Закрывать топ-причины ухода", "Win-back и качественные пуши"],
      pitfalls: ["Смешивать когорты разных каналов и версий"],
      children: [
        {
          id: "d1",
          code: "D1",
          name: "D1 Retention",
          short: "% вернувшихся на следующий день после установки.",
          why: "Проверка: был ли хоть какой-то value на старте.",
          formula: "D1 = users_active_on_day1 / installs_on_day0",
          tags: ["baseline"],
          howImprove: ["Сокращать TTV", "Улучшать Aha", "Стабильность/перфоманс"],
          pitfalls: ["Ранние пуши без ценности дают short-term клики, но убивают доверие"],
          related: ["AHA", "TTV", "CrashFree"]
        },
        {
          id: "d7",
          code: "D7",
          name: "D7 Retention",
          short: "% вернувшихся на 7-й день после установки.",
          why: "Сигнал формирования привычки/регулярной пользы.",
          formula: "D7 = users_active_on_day7 / installs_on_day0",
          tags: ["habit"],
          howImprove: ["Поводы вернуться", "Персонализация", "Контент/циклы ценности"],
          pitfalls: ["Сравнивать D7 между разными категориями продуктов без контекста"],
          related: ["Stickiness", "CoreActionFreq"]
        },
        {
          id: "d30",
          code: "D30",
          name: "D30 Retention",
          short: "% вернувшихся на 30-й день.",
          why: "Стабильная ценность + качество + монетизация без боли.",
          formula: "D30 = users_active_on_day30 / installs_on_day0",
          tags: ["long-term"],
          howImprove: ["Улучшать продуктовый loop", "Снижать churn", "Качество и roadmap"],
          pitfalls: ["Держать людей только скидками/спамом"],
          related: ["Churn", "LTV"]
        },
        {
          id: "cohort",
          code: "CohortRet",
          name: "Cohort Retention",
          short: "Retention по когортам: канал/страна/версия/сегмент.",
          why: "Находит 'где ломается' и где рост — точечно, а не в среднем по больнице.",
          formula: "Retention segmented by {channel,country,app_version,paywall_variant}",
          tags: ["diagnostic"],
          howImprove: ["Сегментные фиксы", "Локализация", "Фиксы по версиям"],
          pitfalls: ["Мало данных → шум. Смотри доверительные интервалы/объёмы."],
          related: ["D7", "ChannelMix", "PaywallCVR"]
        },
        {
          id: "churn",
          code: "Churn",
          name: "Churn Rate",
          short: "% пользователей, переставших быть активными за период.",
          why: "Обратная сторона retention: показывает 'утечку'.",
          formula: "Churn = users_lost / users_at_start (definition depends on app)",
          tags: ["loss"],
          howImprove: ["Найти причины ухода", "Улучшить core value", "Стабильность/UX"],
          pitfalls: ["Разные определения активности → разные churn"],
          related: ["D30", "WinBack"]
        },
        {
          id: "winback",
          code: "WinBack",
          name: "Re-activation / Win-back",
          short: "Доля вернувшихся после периода неактивности.",
          why: "Дешёвый рост без нового трафика.",
          formula: "WinBack = resurrected_users / dormant_users",
          tags: ["growth"],
          howImprove: ["Персональные кампании", "Новые поводы", "Пуши по реальному триггеру"],
          pitfalls: ["Спамить 'вернись' без конкретной выгоды"],
          related: ["PushOpenRate", "NSM"]
        }
      ]
    },

    {
      id: "mon",
      code: "MON",
      name: "Monetization (Монетизация)",
      short: "Как продукт превращает ценность в деньги (подписка/покупки/реклама).",
      why: "Без здоровой монетизации продукт не масштабируется (или начинает душить UX).",
      tags: ["revenue"],
      howImprove: ["Тайминг и сегментация paywall", "Понятный value", "Годовые планы и бандлы"],
      pitfalls: ["Давить paywall до value → убить activation/retention"],
      children: [
        {
          id: "pay_cvr",
          code: "PaywallCVR",
          name: "Conversion to Paid",
          short: "% перешедших в оплату (free→paid / trial→paid).",
          why: "Главная продуктовая метрика дохода для подписочных моделей.",
          formula: "PaywallCVR = paid_users / paywall_viewers (или trial_to_paid)",
          tags: ["subscription"],
          howImprove: ["Показывать paywall после value", "Паковать выгоды, не фичи", "Сегменты и A/B"],
          pitfalls: ["Мерить только конверсию, игнорируя refunds и churn платящих"],
          related: ["ARPU", "RefundRate", "LTV"]
        },
        {
          id: "arpu",
          code: "ARPU/ARPPU",
          name: "ARPU / ARPPU",
          short: "Средний доход на пользователя / на платящего.",
          why: "Понимаешь качество монетизации и потенциал прайса.",
          formula: "ARPU = revenue / active_users; ARPPU = revenue / paying_users",
          tags: ["pricing"],
          howImprove: ["Тарифная сетка", "Апселлы", "Годовые планы", "Бандлы"],
          pitfalls: ["Поднимать ARPU ценой churn (короткий всплеск, потом падение)"],
          related: ["LTV", "Payback"]
        },
        {
          id: "ltv",
          code: "LTV",
          name: "LTV (Lifetime Value)",
          short: "Ожидаемый доход за 'жизнь' пользователя.",
          why: "Определяет допустимый CAC и масштабирование.",
          formula: "LTV ≈ ARPU * avg_lifetime (или модель по retention кривой)",
          tags: ["unit-econ"],
          howImprove: ["Повышать retention", "Улучшать paywall CVR", "Снижать refunds"],
          pitfalls: ["Считать LTV без когорт и без канала → ложная уверенность"],
          related: ["CAC", "LTV/CAC"]
        },
        {
          id: "refund",
          code: "RefundRate",
          name: "Refund / Chargeback Rate",
          short: "Доля возвратов и спорных списаний.",
          why: "Сигнал проблем с обещанием, UX оплаты или качеством продукта.",
          formula: "RefundRate = refunds / purchases",
          tags: ["trust"],
          howImprove: ["Чёткое обещание в paywall", "Честный trial", "Стабильность и поддержка"],
          pitfalls: ["Пытаться 'скрыть отмену' — это удар по репутации"],
          related: ["Rating", "Reviews"]
        },
        {
          id: "mrr",
          code: "MRR/ARR",
          name: "Revenue / MRR / ARR",
          short: "Общий доход и подписочный доход в месяц/год.",
          why: "Бизнес-результат и устойчивость.",
          formula: "MRR = Σ(subscription_monthly_equivalent)",
          tags: ["business"],
          howImprove: ["Ret. платящих", "Годовые планы", "Уменьшать churn платящих"],
          pitfalls: ["Расти MRR за счёт скидок без удержания"],
          related: ["PaywallCVR", "PaidChurn"]
        }
      ]
    },

    {
      id: "qual",
      code: "QUAL",
      name: "Quality & Reliability (Качество)",
      short: "Стабильность, скорость и ощущение надёжности продукта.",
      why: "Качество напрямую влияет на activation/retention и рейтинги в сторах.",
      tags: ["performance", "stability"],
      howImprove: ["Приоритизировать топ-краши", "Оптимизировать латентность", "Наблюдаемость (monitoring)"],
      pitfalls: ["Игнорировать перфоманс на средних девайсах"],
      children: [
        {
          id: "crashfree",
          code: "CrashFree",
          name: "Crash-free users/sessions",
          short: "Доля пользователей/сессий без крашей.",
          why: "Краши убивают доверие и удержание.",
          formula: "CrashFree = 1 - (crash_users / active_users)",
          tags: ["stability"],
          howImprove: ["Фикс топ-крашей", "QA на ключевых девайсах", "Feature flags"],
          pitfalls: ["Фокус только на % без анализа impact (какие экраны/сегменты)"],
          related: ["D1", "Rating"]
        },
        {
          id: "latency",
          code: "Latency",
          name: "Latency / Load time",
          short: "Скорость запуска/загрузки экранов/API.",
          why: "Скорость = конверсия и удержание.",
          formula: "p50/p95 load_time for key screens",
          tags: ["performance"],
          howImprove: ["Кэш", "Lazy-load", "Скелетоны", "Оптимизация запросов"],
          pitfalls: ["Оптимизировать среднее, игнорируя p95 (хвост боли)"],
          related: ["TTV", "SessionsPerUser"]
        },
        {
          id: "rating",
          code: "Rating",
          name: "Store Rating",
          short: "Средняя оценка приложения.",
          why: "Влияет на органику и доверие.",
          formula: "Avg rating in App Store / Google Play",
          tags: ["store"],
          howImprove: ["Просить оценку после value", "Закрывать топ-проблемы", "Поддержка/FAQ"],
          pitfalls: ["Просить оценку на первом запуске"],
          related: ["Reviews", "CVR_Install"]
        },
        {
          id: "reviews",
          code: "Reviews",
          name: "Reviews sentiment",
          short: "Тональность и темы отзывов.",
          why: "Быстрый источник проблем/инсайтов, влияет на конверсию в установку.",
          formula: "Topic clusters + sentiment (manual/auto)",
          tags: ["voice-of-customer"],
          howImprove: ["Кластеризация тем", "Ответы на ключевые", "Fix top pains"],
          pitfalls: ["Реагировать на единичные отзывы без данных"],
          related: ["Rating", "RefundRate"]
        }
      ]
    },

    {
      id: "ue",
      code: "UE",
      name: "Unit Economics (Экономика)",
      short: "Связывает Acquisition + Monetization + Retention и отвечает: можно ли масштабироваться.",
      why: "Если LTV/CAC плохой — рост будет пожирать деньги.",
      tags: ["finance"],
      howImprove: ["Повышать LTV", "Снижать CAC", "Ускорять payback"],
      pitfalls: ["Считать экономику без когорт и payback"],
      children: [
        {
          id: "cac",
          code: "CAC",
          name: "CAC (Customer Acquisition Cost)",
          short: "Стоимость привлечения платящего/целевого пользователя.",
          why: "Определяет, сколько можно тратить на рост.",
          formula: "CAC = spend / acquired_paying_users (or qualified users)",
          tags: ["ads"],
          howImprove: ["Оптимизация каналов", "Повышать конверсию в оплату", "Сегментация"],
          pitfalls: ["Считать CAC по установкам вместо платящих/квалифицированных"],
          related: ["LTV", "Payback"]
        },
        {
          id: "ltvcac",
          code: "LTV/CAC",
          name: "LTV/CAC",
          short: "Соотношение ценности к стоимости привлечения.",
          why: "Проверка жизнеспособности роста.",
          formula: "LTV/CAC = LTV / CAC",
          tags: ["health"],
          howImprove: ["Ret. платящих", "Прайс/упаковка", "Снижение refunds"],
          pitfalls: ["Игнорировать время окупаемости (payback)"],
          related: ["LTV", "CAC", "Payback"]
        },
        {
          id: "payback",
          code: "Payback",
          name: "Payback Period",
          short: "За сколько окупается CAC.",
          why: "Влияет на кэш-флоу и риск.",
          formula: "Payback = time until cumulative margin >= CAC",
          tags: ["cashflow"],
          howImprove: ["Ранняя монетизация", "Годовые планы", "Снижение churn"],
          pitfalls: ["Окупаемость ‘на бумаге’ без учёта refunds"],
          related: ["RefundRate", "MRR/ARR"]
        }
      ]
    }
  ]
};

if (typeof globalThis !== "undefined") {
  globalThis.METRIC_TREE = METRIC_TREE;
}
