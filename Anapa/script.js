// Ваш API ключ для WeatherAPI
const apiKey = '8022e353d6624560b73205928241910';
// URL для запроса прогнозов (включая почасовой и дневной прогнозы) в Анапе
let apiUrl = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=Anapa&days=7&aqi=no&alerts=no`;

// Функция для получения и обновления данных о температуре воды с WeatherAPI
function updateTemperatureFromWeatherAPI(date = new Date()) {
    fetch(`${apiUrl}`)
        .then(response => response.json())  // Получаем данные в формате JSON
        .then(data => {
            const currentTemp = data.current.temp_c; // Текущая температура
            const waterTemp = data.current.temp_c; // Текущая температура воды, если доступна

            // Обновляем "сейчас" с текущей температурой
            const tempCurrentWrapper = document.getElementById('temp-current-wrapper');
            const tempCurrent = document.getElementById('temp-current');
            tempCurrent.textContent = `+${waterTemp}°`; // Убираем "С", оставляем только "°"

            // Меняем цвет фона и текста текущей температуры в зависимости от температуры
            const bgColor = getColorByTemp(waterTemp);
            tempCurrentWrapper.style.backgroundColor = bgColor;
            tempCurrent.style.color = '#000'; // Черный цвет текста для текущей температуры

            // Обновляем дату и время "сейчас"
            const now = date;
            const currentDate = now.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
            const currentTime = now.toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit'
            });
            document.getElementById('current-date').textContent = `Сегодня: ${currentDate}, Сейчас: ${currentTime}`;

            // Обновляем прогноз на следующие 7 часов
            updateHourlyForecast(data.forecast.forecastday[0].hour, now);

            // Обновляем прогнозы на следующие 7 дней
            updateDailyForecast(data.forecast.forecastday);
        })
        .catch(error => {
            console.error('Ошибка при получении данных от WeatherAPI:', error);
            document.getElementById('temp-current').textContent = 'Ошибка загрузки';
        });
}

// Функция для обновления прогноза на следующие 7 часов
function updateHourlyForecast(hourlyData, startDate) {
    let now = new Date(startDate);  // Текущее время
    now.setMinutes(0);  // Устанавливаем минуты на 00 (кратно одному часу)
    
    let hourlyForecast = document.getElementById('hourly-forecast');
    hourlyForecast.innerHTML = '';  // Очищаем старые прогнозы

    let row = document.createElement('tr');

    for (let i = 0; i < 7; i++) {  // Берем прогноз на следующие 7 часов
        const forecastTime = new Date(hourlyData[now.getHours() + i].time);  // Почасовой прогноз

        const timeLabel = forecastTime.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });

        const temp = hourlyData[now.getHours() + i].temp_c;  // Температура на данный час

        const cell = document.createElement('td');
        cell.style.backgroundColor = getColorByTemp(temp);
        cell.innerHTML = `<div>${timeLabel}</div><div class="cell-temp">+${temp}°</div>`; // Убираем "С", оставляем только "°"
        row.appendChild(cell);
    }

    hourlyForecast.appendChild(row);
}

// Функция для обновления прогноза на следующие 7 дней (средняя температура)
function updateDailyForecast(dailyData) {
    let dailyForecast = document.getElementById('daily-forecast');
    dailyForecast.innerHTML = '';  // Очищаем старые прогнозы

    let row = document.createElement('tr');

    for (let i = 0; i < 7; i++) {  // Прогноз на 7 дней
        const forecastDate = new Date(dailyData[i].date);  // Дата прогноза

        const dayLabel = forecastDate.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short'
        });

        const temp = dailyData[i].day.avgtemp_c;  // Средняя температура за день

        const cell = document.createElement('td');
        cell.style.backgroundColor = getColorByTemp(temp);
        cell.innerHTML = `<div>${dayLabel}</div><div class="cell-temp">+${temp}°</div>`; // Убираем "С", оставляем только "°"
        row.appendChild(cell);
    }

    dailyForecast.appendChild(row);
}

// Обновленная функция для определения цвета по температуре с новыми цветами
function getColorByTemp(temp) {
    if (temp <= 12) return '#01A5E7';  // 12°C и ниже
    if (temp <= 13) return '#0EEADD';  // 12-13°C
    if (temp <= 14) return '#2BF88D';  // 13-14°C
    if (temp <= 15) return '#9FFF52';  // 14-15°C
    if (temp <= 16) return '#F1FD46';  // 15-16°C
    if (temp <= 17) return '#FEED3D';  // 16-17°C
    if (temp <= 18) return '#FFC22D';  // 17-18°C
    if (temp <= 19) return '#FF9225';  // 18-19°C
    if (temp <= 20) return '#FF5B35';  // 19-20°C
    return '#FF384B';  // Температуры выше 20°C
}

// Функция для обработки выбора даты
function handleDateSelection() {
    const selectedDate = document.getElementById('date-picker').value;
    const selectedDateObj = new Date(selectedDate);
    updateTemperatureFromWeatherAPI(selectedDateObj);
}

// Обработчик события нажатия клавиши "W"
document.addEventListener('keydown', function(event) {
    if (event.key === 'w' || event.key === 'W') {
        const datePickerContainer = document.getElementById('date-picker-container');
        datePickerContainer.classList.toggle('hidden');  // Показываем/скрываем блок выбора даты
    }
});

// Запуск обновления данных
updateTemperatureFromWeatherAPI();

// Добавление обработчика для кнопки ОК
document.getElementById('submit-date').addEventListener('click', handleDateSelection);
