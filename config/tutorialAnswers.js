const TUTORIAL_IMAGE_ID = 3;
const TUTORIAL_VERIFICATION_SAMPLE_ID = 70;

const createAnswerSpec = (overrides = {}) => ({
  acceptableValues: [],
  acceptablePatterns: [],
  matchMode: 'exact',
  normalize: {
    trim: true,
    collapseWhitespace: true,
    toLowerCase: true
  },
  tolerance: {
    allowThousandsSeparator: false,
    numericDelta: 0
  },
  notes: '',
  failureMessage: '❌ 請再確認這題的答案是否與圖片一致。',
  ...overrides
});

const buildAnswerSpecs = config =>
  Object.entries(config).reduce((result, [key, overrides]) => {
    result[key] = createAnswerSpec(overrides);
    return result;
  }, {});

const BASE_ANSWER_CONFIG = {
  department: {
    acceptableValues: ['中央研究院'],
    failureMessage: '❌ 部會名稱要照圖片填寫，請再確認「單位名稱」。'
  },
  budget_subject: {
    acceptableValues: ['大陸地區旅費'],
    failureMessage: '❌ 預算科目需與圖片一致，請重新檢查「科目（計畫）名稱」。'
  },
  budget_amount: {
    acceptableValues: ['6185000'],
    matchMode: 'number',
    tolerance: { allowThousandsSeparator: true, numericDelta: 0 },
    failureMessage: '❌ 預算金額是「本年度預算數」後面的數字，且要把金額轉換成阿拉伯數字，也不要填千分位（,）記號，請再次確認。'
  },
  action_type: {
    acceptableValues: ['減列＋凍結'],
    failureMessage: '❌ 請依圖片上標示的減列／凍結資訊選擇正確提案類型。'
  },
  reduction_amount: {
    acceptableValues: ['1000000'],
    matchMode: 'number',
    tolerance: { allowThousandsSeparator: true, numericDelta: 0 },
    failureMessage: '❌ 減列金額是「減列數」後面的數字，把金額轉換成阿拉伯數字，也不要填千分位（,）記號，請再次確認。。'
  },
  freeze_amount: {
    acceptableValues: ['2000000'],
    matchMode: 'number',
    tolerance: { allowThousandsSeparator: true, numericDelta: 0 },
    failureMessage: '❌ 凍結金額是「凍結數」後面的數字，把金額轉換成阿拉伯數字，也不要填千分位（,）記號，請再次確認。'
  },
  proposal_reason: {
    acceptableValues: [
      '有鑑於陸委會今年8月28日舉行諮詢委員會議，會中學者指出中國與西方國家經貿關係趨於緊張之際，在科技創新和產業升級方面，仍難以擺脫科研人才短缺以及核心技術受牽制的現狀；中國政府對我國文攻武嚇力道只增不減，多次片面禁止並限制我國農產品輸入外，可想中國對我國人才挖角及竊取核心技術行為恐更為頻繁；綜上，我國國民赴中國風險倍增，爰予減列100萬元，並凍結200萬元，俟中央研究院向立法院教育及文化委員會提出書面報告經同意後，始得動支。',
      '有鑑於陸委會今年8月28日舉行諮詢委員會議，會中學者指出中國與西方國家經貿關係趨於緊張之際，在科技創新和產業升級方面，仍難以擺脫科研人才短缺以及核心技術受牽制的現狀；中國政府對我國文攻武嚇力道只增不減，多次片面禁止並限制我國農產品輸入外，可想中國對我國人才挖角及竊取核心技術行為恐更為頻繁；綜上，我國國民赴中國風險倍增，爱予減列100萬元，並凍結200萬元，俟中央研究院向立法院教育及文化委員會提出書面報告經同意後，始得動支。'
    ],
    matchMode: 'partial',
    notes: '若需斷句、標點差異，請在 acceptablePatterns 放關鍵片段',
    failureMessage: '❌ 案由內容需要完整複製圖片中「案由：」以下的文字，請使用 LINE 的「轉為文字」功能，擷取文字後輸入。開頭不要輸入「案由：」。複製完後不需要處理空格或空行，程式會自動轉換。'
  },
  proposer: {
    acceptableValues: ['郭昱晴','看不清楚'],
    failureMessage: '❌ 提案人要填寫圖片上列出的姓名，請再確認。如果無法辨識人名，請輸入看不清楚'
  },
  co_signers: {
    acceptableValues: ['陳秀寶、林宜瑾','看不清楚、林宜瑾','看不清楚、看不清楚','看不清楚、陳秀寶','陳秀寶、看不清楚','林宜瑾、看不清楚','陳秀寳、看不清楚','陳秀寳、林宜瑾','林宜瑾、陳秀寳'],
    failureMessage: '❌ 連署人要填寫圖片上列出的姓名（若無特別標示，通常為第二行開始的名字），多人要用「、」隔開。若看不清楚可使用「看不清楚」。'
  }
};

const recognitionAnswers = buildAnswerSpecs(BASE_ANSWER_CONFIG);
const verificationAnswers = JSON.parse(JSON.stringify(recognitionAnswers));

const TUTORIAL_VERIFICATION_INCORRECT_RESPONSES = {
  department: '中央研究院',
  budget_subject: '大陸地區旅費',
  budget_amount: '6185000',
  action_type: '減列＋凍結',
  reduction_amount: '2000000',
  freeze_amount: '2000000',
  proposal_reason: '有鑑於陸委會今年8月28日舉行諮詢委員會議，會中學者指出中國與西方國家經貿關係趨於緊張之際，在科技創新和產業升級方面，仍難以擺脫科研人才短缺以及核心技術受牽制的現狀；中國政府對我國文攻武嚇力道只增不減，多次片面禁止並限制我國農產品輸入外，可想中國對我國人才挖角及竊取核心技術行為恐更為頻繁；綜上，我國國民赴中國風險倍增，爰予減列100萬元，並凍結200萬元，俟中央研究院向立法院教育及文化委員會提出書面報告經同意後，始得動支。',
  proposer: '郭昱晴',
  co_signers: '陳秀寶、林宜瑾'
};

const TUTORIAL_CORRECT_ANSWERS = {
  recognition: recognitionAnswers,
  verification: verificationAnswers
};

const TUTORIAL_FLOW_STEPS = {
  recognition: [
    'department',
    'budget_subject',
    'budget_amount',
    'action_type',
    'reduction_amount',
    'freeze_amount',
    'proposal_reason',
    'proposer',
    'co_signers'
  ],
  verification: []
};

const TUTORIAL_VERIFICATION_STAGES = [
  {
    id: 'first_stage',
    type: 'correction',
    failureMessage: '❌ 還有欄位沒有修正為正確答案，請重新複製列表後修改（小提示：減列金額是不是錯了呢？）',
    successMessage: '✅ 第一階段：欄位修正完成！'
  },
  {
    id: 'second_stage',
    type: 'confirmation',
    correctResponses: ['verify_second_stage_correct'],
    failureMessage: '❌ 案由內容其實沒有問題，請點選「✅ 案由正確」繼續。',
    successMessage: '✅ 第二階段：案由確認完成！'
  }
];

module.exports = {
  TUTORIAL_IMAGE_ID,
  TUTORIAL_VERIFICATION_SAMPLE_ID,
  TUTORIAL_CORRECT_ANSWERS,
  TUTORIAL_FLOW_STEPS,
  TUTORIAL_VERIFICATION_STAGES,
  TUTORIAL_VERIFICATION_INCORRECT_RESPONSES
}