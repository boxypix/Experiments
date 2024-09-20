let gradientData = [
    {
        "color": "#3860EE",
        "value": 0,
        "alpha": 0.0,
        "wnd": "Blue start"
    },
    {
        "color": "#46B1FF",
        "value": 5.0,
        "alpha": 0.5,
        "wnd": "Sky"
    },
    {
        "color": "#51ED29",
        "value": 10.0,
        "alpha": 0.75,
        "wnd": "Green"
    },
    {
        "color": "#BDFF00",
        "value": 15.0,
        "alpha": 1.0,
        "wnd": "Lemon"
    },
    {
        "color": "#FFC700",
        "value": 20.0,
        "alpha": 1.0,
        "wnd": "Orange"
    },
    {
        "color": "#FF8541",
        "value": 25.0,
        "alpha": 1.0,
        "wnd": "Red"
    },
    {
        "color": "#FF416E",
        "value": 30.0,
        "alpha": 1.0,
        "wnd": "Purple finish"
    }
];

const gradientContainer = document.getElementById('gradientContainer');
const gradientPreview = document.getElementById('gradientPreview');
const exportedJsonElement = document.getElementById('exportedJson');

const headerTitle = document.getElementById('headerTitle');
let currentFileName = '';

// Функция для обновления заголовка с названием файла
function updateHeaderTitle() {
    if (currentFileName) {
        headerTitle.textContent = `Vova's JSON Gradient Editor / ${currentFileName}`;
    } else {
        headerTitle.textContent = `Vova's JSON Gradient Editor`;
    }
}

// Функция для обновления отображения градиента
function renderGradient() {
    gradientContainer.innerHTML = '';  // Очистка контейнера перед рендерингом

    gradientData.forEach((step, index) => {
        const stepElement = document.createElement('div');
        stepElement.className = 'gradient-step';

        const colorPreview = document.createElement('div');
        colorPreview.className = 'color-preview';
        colorPreview.style.backgroundColor = step.color;
        colorPreview.style.opacity = step.alpha;

        console.log(`Rendering step: color=${step.color}, alpha=${step.alpha}`); // Debugging line

        const controls = document.createElement('div');
        controls.className = 'controls';

        // Поле для выбора цвета
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = step.color;
        colorInput.style.borderColor = '#71828F';
        colorInput.addEventListener('input', (e) => {
            step.color = e.target.value;
            console.log(`Color changed: ${step.color}`); // Debugging line
            renderGradientPreview();  // Обновляем отображение градиента
        });

        // Ползунок для прозрачности + текстовое поле
        const alphaInput = document.createElement('input');
        alphaInput.type = 'range';
        alphaInput.min = 0;
        alphaInput.max = 1;
        alphaInput.step = 0.01;
        alphaInput.value = step.alpha;
        alphaInput.className = 'alpha-range';
        alphaInput.addEventListener('input', (e) => {
            step.alpha = e.target.value;
            alphaText.value = step.alpha;
            console.log(`Alpha changed: ${step.alpha}`); // Debugging line
            renderGradientPreview();  // Обновляем отображение градиента
        });

        const alphaText = document.createElement('input');
        alphaText.type = 'number';
        alphaText.min = 0;
        alphaText.max = 1;
        alphaText.step = 0.01;
        alphaText.value = step.alpha;
        alphaText.addEventListener('input', (e) => {
            step.alpha = e.target.value;
            alphaInput.value = step.alpha;
            console.log(`Alpha text changed: ${step.alpha}`); // Debugging line
            renderGradientPreview();  // Обновляем отображение градиента
        });

        // Ползунок для value + текстовое поле
        const valueInput = document.createElement('input');
        valueInput.type = 'range';
        valueInput.min = 0;
        valueInput.max = 30;
        valueInput.step = 0.1;
        valueInput.value = step.value;
        valueInput.style.borderColor = '#71828F';
        valueInput.addEventListener('input', (e) => {
            step.value = e.target.value;
            valueText.value = step.value;
            console.log(`Value changed: ${step.value}`); // Debugging line
            renderGradientPreview();  // Обновляем отображение градиента
        });

        const valueText = document.createElement('input');
        valueText.type = 'number';
        valueText.min = 0;
        valueText.max = 30;
        valueText.step = 0.1;
        valueText.value = step.value;
        valueText.addEventListener('input', (e) => {
            step.value = e.target.value;
            valueInput.value = step.value;
            console.log(`Value text changed: ${step.value}`); // Debugging line
            renderGradientPreview();  // Обновляем отображение градиента
        });

        // Поле для комментария
        const commentInput = document.createElement('input');
        commentInput.type = 'text';
        commentInput.value = step.wnd;
        commentInput.placeholder = 'Comment';
        commentInput.addEventListener('input', (e) => {
            step.wnd = e.target.value;
        });

        // Кнопка для добавления нового шага после текущего
        const addButton = document.createElement('button');
        addButton.textContent = 'Add';
        addButton.className = 'add-button';
        addButton.addEventListener('click', () => {
            const newStep = {
                color: '#000000',
                value: 0,
                alpha: 1,
                wnd: 'Name'
            };
            gradientData.splice(index + 1, 0, newStep);  // Вставляем новый шаг после текущего
            renderGradient();  // Обновляем рендеринг
            renderGradientPreview();  // Обновляем отображение градиента
        });

        // Кнопка для удаления текущего шага
        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Remove';
        deleteButton.className = 'delete-button';
        deleteButton.addEventListener('click', () => {
            if (gradientData.length > 1) {
                gradientData.splice(index, 1);  // Удаляем текущий шаг
                renderGradient();  // Обновляем рендеринг
                renderGradientPreview();  // Обновляем отображение градиента
            } else {
                alert('Должен остаться хотя бы один шаг!');
            }
        });

        // Добавляем элементы управления на страницу
        controls.appendChild(colorInput);
        controls.appendChild(alphaInput);
        controls.appendChild(alphaText);
        controls.appendChild(valueInput);
        controls.appendChild(valueText);
        controls.appendChild(commentInput);
        controls.appendChild(addButton);
        controls.appendChild(deleteButton);

        //stepElement.appendChild(colorPreview);
        stepElement.appendChild(controls);
        gradientContainer.appendChild(stepElement);
    });
}

// Функция для экспорта JSON файла
function exportJsonFile() {
    const jsonString = JSON.stringify(gradientData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'gradient.json';
    link.click();
}

// Функция для показа JSON текста
function showJsonText() {
    exportedJsonElement.style.display = exportedJsonElement.style.display === 'none' ? 'block' : 'none';
    exportedJsonElement.textContent = JSON.stringify(gradientData, null, 2);
}

// Функция для импорта JSON файла
function importJsonFile(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        currentFileName = file.name; // Обновляем название файла
        updateHeaderTitle(); // Обновляем заголовок
        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                importedData.forEach(step => {
                    if (!step.hasOwnProperty('alpha')) {
                        step.alpha = 1.0;  // По умолчанию alpha = 1.0
                    }
                    if (!step.hasOwnProperty('wnd')) {
                        step.wnd = 'Name';  // По умолчанию wnd = 'Name'
                    }
                });

                gradientData = importedData;
                renderGradient();
                renderGradientPreview();
            } catch (error) {
                alert('🤌 Загружай только стили покрасок! Ошибка при чтении файла JSON');
            }
        };
        reader.readAsText(file);
    }
}

// Функция для создания градиента с учетом alpha
function renderGradientPreview() {
    const maxValue = 30; // Устанавливаем максимальное значение для value
    const gradientStops = gradientData.map(step => {
        // Преобразование HEX в RGBA
        const hex = step.color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const a = step.alpha;

        // Формирование строки цвета в формате rgba
        const color = `rgba(${r}, ${g}, ${b}, ${a})`;

        // Преобразуем значение в проценты относительно maxValue
        const adjustedValue = (step.value / maxValue) * 100;

        return `${color} ${adjustedValue}%`;
    }).join(', ');

    gradientPreview.style.background = `linear-gradient(to right, ${gradientStops})`;
}

// Рендеринг начальных данных
renderGradient();
renderGradientPreview();