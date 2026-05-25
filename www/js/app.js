const app = {
    allQuestions: [],
    questions: [],
    currentIndex: 0,
    quizType: null,
    quizName: "",
    sessionMode: null,
    selectedQuizConfig: null
};

const csvFiles = {
    test500: {
        title: "Test de 500 preguntas",
        path: "data/preguntas_test_500_con_respuestas.csv",
        storageKey: "quiz_session_test_500"
    },
    test200: {
        title: "Test de 200 preguntas",
        path: "data/preguntas_test_200_con_correcta.csv",
        storageKey: "quiz_session_test_200"
    }
};

document.addEventListener("deviceready", initApp, false);

// Permite probar también en navegador sin Cordova.
document.addEventListener("DOMContentLoaded", () => {
    if (!window.cordova) {
        initApp();
    }
});

function initApp() {
    document.getElementById("btn-test-500").addEventListener("click", () => selectQuiz("test500"));
    document.getElementById("btn-test-200").addEventListener("click", () => selectQuiz("test200"));

    document.getElementById("btn-session-back").addEventListener("click", goHome);
    document.getElementById("btn-new-session").addEventListener("click", startNewSession);
    document.getElementById("btn-continue-session").addEventListener("click", continuePreviousSession);

    document.getElementById("btn-prev").addEventListener("click", previousQuestion);
    document.getElementById("btn-next").addEventListener("click", nextQuestion);
    document.getElementById("btn-finish").addEventListener("click", finishQuiz);
    document.getElementById("btn-exit").addEventListener("click", goHome);

    document.getElementById("btn-continue-after-result").addEventListener("click", continueAfterResult);
    document.getElementById("btn-result-home").addEventListener("click", goHome);
    document.getElementById("btn-message-back").addEventListener("click", goHome);
}

function selectQuiz(type) {
    app.quizType = type;
    app.selectedQuizConfig = csvFiles[type];
    app.quizName = app.selectedQuizConfig.title;

    document.getElementById("session-quiz-title").textContent = app.quizName;

    const session = loadSession(type);
    const btnContinue = document.getElementById("btn-continue-session");
    const sessionInfo = document.getElementById("session-info");

    if (session && Array.isArray(session.questionsState)) {
        const total = session.questionsState.length;
        const answered = session.questionsState.filter(q => q.isAnswered).length;
        const pending = total - answered;

        sessionInfo.textContent = `Hay una sesión guardada: ${answered} respondidas y ${pending} pendientes de ${total} preguntas.`;
        btnContinue.disabled = pending === 0;
        btnContinue.textContent = pending === 0
            ? "No quedan preguntas pendientes"
            : "Continuar sesión anterior";
    } else {
        sessionInfo.textContent = "No hay ninguna sesión anterior guardada para este test.";
        btnContinue.disabled = true;
        btnContinue.textContent = "Continuar sesión anterior";
    }

    showScreen("session-screen");
}

async function startNewSession() {
    if (!app.quizType) {
        goHome();
        return;
    }

    showMessage("Cargando cuestionario...", "Creando una sesión nueva.");

    try {
        const questions = await loadQuestionsFromCsv(app.quizType);

        app.allQuestions = shuffleArray(questions).map(prepareQuestion);
        app.questions = app.allQuestions;
        app.currentIndex = 0;
        app.sessionMode = "new";

        saveCurrentSession();

        document.getElementById("quiz-title").textContent = app.quizName;
        showScreen("quiz-screen");
        renderQuestion();
    } catch (error) {
        console.error(error);
        showMessage(
            "Error al cargar el test",
            "Revisa que el archivo exista en www/data/ y que tenga el formato correcto. Detalle: " + error.message
        );
    }
}

async function continuePreviousSession() {
    if (!app.quizType) {
        goHome();
        return;
    }

    const session = loadSession(app.quizType);

    if (!session || !Array.isArray(session.questionsState)) {
        showMessage("Sin sesión guardada", "No existe ninguna sesión anterior para continuar.");
        return;
    }

    const pendingQuestions = session.questionsState.filter(q => !q.isAnswered);

    if (pendingQuestions.length === 0) {
        showMessage("Sesión completada", "No quedan preguntas pendientes en esta sesión.");
        return;
    }

    app.allQuestions = session.questionsState;
    app.questions = pendingQuestions;
    app.currentIndex = 0;
    app.sessionMode = "continue";
    app.quizName = csvFiles[app.quizType].title;

    document.getElementById("quiz-title").textContent = app.quizName + " · pendientes";
    showScreen("quiz-screen");
    renderQuestion();
}

async function loadQuestionsFromCsv(type) {
    const selected = csvFiles[type];
    const response = await fetch(selected.path);

    if (!response.ok) {
        throw new Error("No se pudo cargar el archivo: " + selected.path);
    }

    const csvText = await response.text();
    const rows = parseCSV(csvText);
    const questions = normalizeRows(rows);

    if (questions.length === 0) {
        throw new Error("No se han encontrado preguntas válidas en el CSV.");
    }

    return questions;
}

/**
 * Parser CSV compatible con:
 * - Campos entrecomillados.
 * - Comas dentro de campos.
 * - Saltos de línea dentro de campos.
 * - Comillas escapadas como "".
 */
function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let insideQuotes = false;

    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                field += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (char === "," && !insideQuotes) {
            row.push(field.trim());
            field = "";
        } else if (char === "\n" && !insideQuotes) {
            row.push(field.trim());
            field = "";

            if (row.some(cell => cell !== "")) {
                rows.push(row);
            }

            row = [];
        } else {
            field += char;
        }
    }

    if (field.length > 0 || row.length > 0) {
        row.push(field.trim());
        if (row.some(cell => cell !== "")) {
            rows.push(row);
        }
    }

    return rows;
}

/**
 * Convierte filas CSV en objetos pregunta.
 *
 * Soporta estos dos formatos:
 * CSV 500:
 * numero,pregunta,respuesta_a,respuesta_b,respuesta_c,respuesta_d,respuesta_correcta
 *
 * CSV 200:
 * pregunta,respuesta_a,respuesta_b,respuesta_c,respuesta_d,correcta
 *
 * También permite correcta = -1, que significa respuesta ambigua.
 */
function normalizeRows(rows) {
    if (!rows || rows.length < 2) {
        return [];
    }

    const headers = rows[0].map(h => normalizeHeader(h));
    const dataRows = rows.slice(1);

    const indexNumero = headers.indexOf("numero");
    const indexPregunta = headers.indexOf("pregunta");
    const indexA = headers.indexOf("respuesta_a");
    const indexB = headers.indexOf("respuesta_b");
    const indexC = headers.indexOf("respuesta_c");
    const indexD = headers.indexOf("respuesta_d");

    let indexCorrecta = headers.indexOf("respuesta_correcta");

    if (indexCorrecta === -1) {
        indexCorrecta = headers.indexOf("correcta");
    }

    const questions = [];

    dataRows.forEach((row, rowIndex) => {
        const questionText = cleanCell(row[indexPregunta]);
        const answers = [
            cleanCell(row[indexA]),
            cleanCell(row[indexB]),
            cleanCell(row[indexC]),
            cleanCell(row[indexD])
        ];

        const correctOriginalIndex = parseInt(cleanCell(row[indexCorrecta]), 10);

        // Permitimos -1 porque indica respuesta ambigua.
        if (
            !questionText ||
            answers.some(answer => !answer) ||
            Number.isNaN(correctOriginalIndex) ||
            correctOriginalIndex < -1 ||
            correctOriginalIndex > 3
        ) {
            console.warn("Fila ignorada por formato no válido:", rowIndex + 2, row);
            return;
        }

        questions.push({
            id: buildQuestionId(rowIndex, indexNumero >= 0 ? cleanCell(row[indexNumero]) : String(rowIndex + 1), questionText),
            number: indexNumero >= 0 ? cleanCell(row[indexNumero]) : String(rowIndex + 1),
            text: questionText,
            answers: answers,
            correctOriginalIndex: correctOriginalIndex,
            isAmbiguous: correctOriginalIndex === -1,
            selectedOptionIndex: null,
            isAnswered: false,
            isCorrect: false,
            isCorrected: false,
            isEvaluated: false
        });
    });

    return questions;
}

function buildQuestionId(rowIndex, number, questionText) {
    // ID estable para guardar sesión. No necesita ser criptográfico.
    return `${rowIndex + 1}_${number}_${questionText.slice(0, 40)}`;
}

function normalizeHeader(header) {
    return String(header || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/^"|"$/g, "");
}

function cleanCell(value) {
    return String(value ?? "")
        .trim()
        .replace(/^"|"$/g, "");
}

/**
 * Prepara cada pregunta:
 * - Convierte respuestas en objetos.
 * - Marca cuál es correcta.
 * - Mezcla el orden de las opciones.
 */
function prepareQuestion(question) {
    const options = question.answers.map((text, index) => ({
        text,
        originalIndex: index,
        isCorrect: !question.isAmbiguous && index === question.correctOriginalIndex
    }));

    question.options = shuffleArray(options);
    question.selectedOptionIndex = null;
    question.isAnswered = false;
    question.isCorrect = false;
    question.isCorrected = false;
    question.isEvaluated = false;

    return question;
}

function renderQuestion() {
    if (app.questions.length === 0) {
        showMessage("Sin preguntas pendientes", "No quedan preguntas por responder en esta sesión.");
        return;
    }

    const question = app.questions[app.currentIndex];

    document.getElementById("question-counter").textContent =
        `Pregunta ${app.currentIndex + 1} / ${app.questions.length}`;

    document.getElementById("score-counter").textContent =
        `Respondidas en sesión: ${getAnsweredCountInSession()} / ${app.allQuestions.length}`;

    document.getElementById("question-text").textContent = question.text;

    const progressPercent = ((app.currentIndex + 1) / app.questions.length) * 100;
    document.getElementById("progress-fill").style.width = progressPercent + "%";

    const answersContainer = document.getElementById("answers-container");
    answersContainer.innerHTML = "";

    question.options.forEach((option, index) => {
        const button = document.createElement("button");
        button.className = "answer-button";
        button.textContent = option.text;

        if (question.selectedOptionIndex === index && !question.isCorrected) {
            button.classList.add("selected-pending");
        }

        if (question.isCorrected) {
            button.classList.add("disabled");

            if (question.isAmbiguous) {
                if (question.selectedOptionIndex === index) {
                    button.classList.add("ambiguous");
                }
            } else {
                if (option.isCorrect) {
                    button.classList.add("correct");
                }

                if (question.selectedOptionIndex === index && !option.isCorrect) {
                    button.classList.add("incorrect");
                }
            }
        }

        button.addEventListener("click", () => selectAnswer(index));
        answersContainer.appendChild(button);
    });

    renderFeedback();
    updateNavigationButtons();
}

function selectAnswer(optionIndex) {
    const question = app.questions[app.currentIndex];

    // Ya respondida → no permitir cambiar
    if (question.isAnswered) {
        return;
    }

    const selectedOption = question.options[optionIndex];

    question.selectedOptionIndex = optionIndex;
    question.isAnswered = true;

    if (question.isAmbiguous) {
        question.isCorrect = false;
    } else {
        question.isCorrect = selectedOption.isCorrect;
    }

    // 🔥 CLAVE: corregimos inmediatamente
    question.isCorrected = true;

    saveCurrentSession();
    renderQuestion();
}


function renderFeedback() {
    const question = app.questions[app.currentIndex];
    const feedback = document.getElementById("feedback");

    feedback.className = "feedback";
    feedback.textContent = "";

    if (!question.isAnswered) {
        return;
    }

    if (!question.isCorrected) {
        //feedback.textContent = "Respuesta seleccionada. Pulsa “Finalizar test” para corregir las preguntas respondidas hasta ahora.";
        //feedback.classList.add("pending-text");
        return;
    }

    if (question.isAmbiguous) {
        feedback.textContent = "Respuesta ambigua: esta pregunta no tiene una respuesta correcta definida en el CSV.";
        feedback.classList.add("ambiguous-text");
        return;
    }

    if (question.isCorrect) {
        feedback.textContent = "Correcto.";
        feedback.classList.add("correct-text");
    } else {
        feedback.textContent = "Incorrecto. La respuesta correcta está marcada en verde.";
        feedback.classList.add("incorrect-text");
    }
}

function previousQuestion() {
    if (app.currentIndex > 0) {
        app.currentIndex--;
        renderQuestion();
    }
}

function nextQuestion() {
    if (app.currentIndex < app.questions.length - 1) {
        app.currentIndex++;
        renderQuestion();
    }
}

function updateNavigationButtons() {
    document.getElementById("btn-prev").disabled = app.currentIndex === 0;

    const btnNext = document.getElementById("btn-next");
    btnNext.textContent = "Siguiente";
    btnNext.disabled = app.currentIndex === app.questions.length - 1;
}

/**
 * Finalizar test corrige las preguntas respondidas hasta el momento.
 * No reinicia la sesión.
 * Al continuar, se mostrarán solo las preguntas no respondidas.
 */
function finishQuiz() {
    // Solo preguntas respondidas desde el último finalizar
    const justAnswered = app.allQuestions.filter(q => 
        q.isAnswered && !q.isEvaluated
    );

    // Marcar como evaluadas
    justAnswered.forEach(q => {
        q.isEvaluated = true;
    });

    saveCurrentSession();
    showFinalMessage(justAnswered);
}

function showFinalMessage(questionsBatch) {
    const batch = Array.isArray(questionsBatch) ? questionsBatch : [];

    const validAnswered = batch.filter(q => !q.isAmbiguous);
    const correct = validAnswered.filter(q => q.isCorrect);
    const ambiguous = batch.filter(q => q.isAmbiguous);
    const percent = Math.round((correct.length / validAnswered.length)*100);

    const totalAnsweredInSession = app.allQuestions.filter(q => q.isAnswered).length;
    const totalAnsweredAmbiguousInSession = app.allQuestions.filter(q => q.isAnswered && q.isAmbiguous).length;
    const totalPendingInSession = app.allQuestions.length - totalAnsweredInSession;
    const totalCorrectInSession = app.allQuestions.filter(q => q.isAnswered && q.isCorrect).length;
    const percentSession = Math.round((totalCorrectInSession/(totalAnsweredInSession-totalAnsweredAmbiguousInSession))*100);

    let resultText = "";

    if (batch.length === 0) {
        resultText = "No has respondido ninguna pregunta nueva desde la última corrección.";
    } else if (validAnswered.length === 0) {
        resultText = "Has respondido preguntas, pero todas son ambiguas y no cuentan para la puntuación.";
    } else {
        resultText = `Has acertado ${correct.length} de ${validAnswered.length} preguntas respondidas (${percent}%).`;
    }

    if (ambiguous.length > 0) {
        resultText += ` Además, hay ${ambiguous.length} pregunta(s) ambigua(s), que no cuentan para la puntuación.`;
    }

    document.getElementById("result-title").textContent = "Resultado del test";
    document.getElementById("result-text").textContent = resultText;

    const details = document.getElementById("result-details");
    details.innerHTML = `
        <ul>
            <li>Preguntas respondidas en esta sesión: ${totalAnsweredInSession}</li>
            <li>Preguntas respondidas ambiguas en esta sesión (no cuentan para la puntuación): ${totalAnsweredAmbiguousInSession}</li>
            <li>Preguntas correctas en esta sesión: ${totalCorrectInSession} (${percentSession}%)</li>
            <li>Preguntas pendientes en esta sesión: ${totalPendingInSession}</li>
            <li>Total de preguntas de la sesión: ${app.allQuestions.length}</li>
        </ul>
    `;

    const btnContinue = document.getElementById("btn-continue-after-result");
    btnContinue.disabled = totalPendingInSession === 0;

    showScreen("result-screen");
}

function continueAfterResult() {
    const pendingQuestions = app.allQuestions.filter(q => !q.isAnswered);

    if (pendingQuestions.length === 0) {
        showMessage("Sesión completada", "No quedan preguntas pendientes en esta sesión.");
        return;
    }

    app.questions = pendingQuestions;
    app.currentIndex = 0;
    app.sessionMode = "continue";

    document.getElementById("quiz-title").textContent = app.quizName + " · pendientes";
    showScreen("quiz-screen");
    renderQuestion();
}

function getAnsweredCountInSession() {
    return app.allQuestions.filter(q => q.isAnswered).length;
}

function saveCurrentSession() {
    if (!app.quizType || !app.selectedQuizConfig) {
        return;
    }

    const session = {
        quizType: app.quizType,
        quizName: app.quizName,
        savedAt: new Date().toISOString(),
        questionsState: app.allQuestions
    };

    localStorage.setItem(app.selectedQuizConfig.storageKey, JSON.stringify(session));
}

function loadSession(type) {
    const config = csvFiles[type];

    if (!config) {
        return null;
    }

    const raw = localStorage.getItem(config.storageKey);

    if (!raw) {
        return null;
    }

    try {
        const session = JSON.parse(raw);

        if (!session || !Array.isArray(session.questionsState)) {
            return null;
        }

        return session;
    } catch (error) {
        console.error("No se pudo leer la sesión guardada", error);
        return null;
    }
}

function goHome() {
    app.allQuestions = [];
    app.questions = [];
    app.currentIndex = 0;
    app.quizType = null;
    app.quizName = "";
    app.sessionMode = null;
    app.selectedQuizConfig = null;

    showScreen("home-screen");
}

function showMessage(title, text) {
    document.getElementById("message-title").textContent = title;
    document.getElementById("message-text").textContent = text;
    showScreen("message-screen");
}

function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach(screen => {
        screen.classList.remove("active");
    });

    document.getElementById(screenId).classList.add("active");
}

/**
 * Fisher-Yates shuffle.
 */
function shuffleArray(array) {
    const copy = [...array];

    for (let i = copy.length - 1; i > 0; i--) {
        const randomIndex = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[randomIndex]] = [copy[randomIndex], copy[i]];
    }

    return copy;
}
