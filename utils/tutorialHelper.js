const {
  TUTORIAL_CORRECT_ANSWERS,
  TUTORIAL_FLOW_STEPS,
  TUTORIAL_IMAGE_ID,
  TUTORIAL_VERIFICATION_STAGES,
  TUTORIAL_VERIFICATION_INCORRECT_RESPONSES,
  TUTORIAL_VERIFICATION_SAMPLE_ID
} = require('../config/tutorialAnswers');

const TUTORIAL_MODE_MAP = {
  recognition: 'recognition',
  verification: 'verification',
  tutorial_recognition: 'recognition',
  tutorial_verification: 'verification'
};

const MODE_LABELS = {
  recognition: '辨識教學',
  verification: '驗證教學'
};

const QUESTION_LABELS = {
  department: '部會名稱',
  budget_subject: '預算科目',
  budget_amount: '預算金額',
  action_type: '提案類型',
  reduction_amount: '減列金額',
  freeze_amount: '凍結金額',
  proposal_reason: '案由',
  proposer: '提案人',
  co_signers: '連署人'
};

function isTutorialMode(mode) {
  return mode === 'tutorial_recognition' || mode === 'tutorial_verification';
}

function getBaseMode(mode) {
  return TUTORIAL_MODE_MAP[mode] || null;
}

function getTutorialFlow(mode) {
  const base = getBaseMode(mode);
  return base ? (TUTORIAL_FLOW_STEPS[base] || []) : [];
}

function getTutorialAnswers(mode) {
  const base = getBaseMode(mode);
  return base ? (TUTORIAL_CORRECT_ANSWERS[base] || {}) : {};
}

function getTutorialLabel(mode) {
  const base = getBaseMode(mode);
  return MODE_LABELS[base] || '教學模式';
}

function getQuestionLabel(questionId) {
  return QUESTION_LABELS[questionId] || '這題';
}

function normalizeAnswer(value, normalizeConfig = {}) {
  if (value === undefined || value === null) return '';
  let normalized = String(value);
  if (normalizeConfig.trim !== false) {
    normalized = normalized.trim();
  }
  if (normalizeConfig.collapseWhitespace !== false) {
    normalized = normalized.replace(/\s+/g, ' ');
  }
  if (normalizeConfig.toLowerCase) {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

function parseNumberValue(value, tolerance = {}, safeMathEval) {
  if (typeof value === 'number') return value;
  if (value === undefined || value === null) return null;

  let numericString = String(value).trim();

  if (tolerance.allowThousandsSeparator) {
    numericString = numericString.replace(/,/g, '');
  }

  if (safeMathEval && /[+\-*/()]/.test(numericString)) {
    const mathResult = safeMathEval(numericString);
    if (typeof mathResult === 'number' && !Number.isNaN(mathResult)) {
      return mathResult;
    }
  }

  const parsed = parseFloat(numericString);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesPatterns(value, patterns = []) {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some(pattern => {
    try {
      const regex = new RegExp(pattern, 'i');
      return regex.test(value);
    } catch (error) {
      console.error('❌ 教學答案正則錯誤:', error.message);
      return false;
    }
  });
}

function getFailureMessage(questionId, matchMode, spec) {
  if (spec && spec.failureMessage) {
    return spec.failureMessage;
  }
  const label = getQuestionLabel(questionId);
  if (matchMode === 'number') {
    return `❌ 「${label}」需要填入正確的數字，請再參考圖片重新輸入。`;
  }
  return `❌ 「${label}」的答案還不太對，請再次確認後再試一次。`;
}

function validateTutorialAnswer(mode, questionId, userAnswer, safeMathEval) {
  const base = getBaseMode(mode);
  if (!base) {
    return { isCorrect: true, normalizedAnswer: userAnswer };
  }

  const answersMap = getTutorialAnswers(base);
  const spec = answersMap[questionId];

  if (!spec) {
    return { isCorrect: true, normalizedAnswer: userAnswer };
  }

  const hasExpectations =
    (spec.acceptableValues && spec.acceptableValues.length > 0) ||
    (spec.acceptablePatterns && spec.acceptablePatterns.length > 0);

  if (!hasExpectations) {
    return { isCorrect: true, normalizedAnswer: userAnswer };
  }

  const matchMode = spec.matchMode || 'exact';

  if (matchMode === 'number') {
    const parsedAnswer = parseNumberValue(userAnswer, spec.tolerance, safeMathEval);
    if (parsedAnswer === null) {
      return {
        isCorrect: false,
        message: getFailureMessage(questionId, matchMode, spec)
      };
    }

    const normalizedAnswer = parsedAnswer.toString();
    const numericDelta = spec.tolerance?.numericDelta ?? 0;

    const acceptableNumbers = (spec.acceptableValues || [])
      .map(value => parseNumberValue(value, spec.tolerance))
      .filter(value => value !== null);

    const isCorrect =
      acceptableNumbers.length === 0 ||
      acceptableNumbers.some(value => Math.abs(parsedAnswer - value) <= numericDelta);

    return {
      isCorrect,
      normalizedAnswer,
      message: isCorrect ? undefined : getFailureMessage(questionId, matchMode, spec)
    };
  }

  const normalizedAnswer = normalizeAnswer(userAnswer, spec.normalize);
  const acceptableValues = (spec.acceptableValues || []).map(value =>
    normalizeAnswer(value, spec.normalize)
  );

  let isCorrect = false;

  if (matchMode === 'partial') {
    isCorrect =
      acceptableValues.some(value => normalizedAnswer.includes(value) || value.includes(normalizedAnswer)) ||
      matchesPatterns(normalizedAnswer, spec.acceptablePatterns);
  } else {
    isCorrect =
      acceptableValues.includes(normalizedAnswer) ||
      matchesPatterns(normalizedAnswer, spec.acceptablePatterns);
  }

  return {
    isCorrect,
    normalizedAnswer,
    message: isCorrect ? undefined : getFailureMessage(questionId, matchMode, spec)
  };
}

function getTutorialVerificationStages() {
  return TUTORIAL_VERIFICATION_STAGES;
}

function getVerificationIncorrectResponses() {
  return { ...TUTORIAL_VERIFICATION_INCORRECT_RESPONSES };
}

function getVerificationSampleId() {
  return TUTORIAL_VERIFICATION_SAMPLE_ID;
}

module.exports = {
  TUTORIAL_IMAGE_ID,
  isTutorialMode,
  getBaseMode,
  getTutorialFlow,
  getTutorialAnswers,
  getTutorialLabel,
  getQuestionLabel,
  validateTutorialAnswer,
  getTutorialVerificationStages,
  getVerificationIncorrectResponses,
  getVerificationSampleId
};

