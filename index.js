const line = require('@line/bot-sdk');
const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
require('dotenv').config();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);
const app = express();

// 引入自定義模組
const KeystoneAPI = require('./utils/keystone');
const UserSessionManager = require('./utils/userSession');
const { QUESTIONS } = require('./config/questions');
const tutorialHelper = require('./utils/tutorialHelper');

// 創建實例
const keystoneAPI = new KeystoneAPI();
const sessionManager = new UserSessionManager();

// 中間件 - LINE middleware 會在路由中直接使用

// 安全數學計算函數
function safeMathEval(expression) {
  try {
    const cleanExpression = expression.replace(/\s/g, '');
    if (!/^[0-9+\-*/.()]+$/.test(cleanExpression)) {
      return null;
    }
    const result = new Function('return ' + cleanExpression)();
    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
      return result;
    }
    return null;
  } catch (error) {
    console.log('數學表達式計算錯誤:', error.message);
    return null;
  }
}

// 正規化案由內容：移除多餘空白與換行，並將文字間的英文逗號改為全形逗號（保留數字中的逗號）
function normalizeProposalReason(input) {
  if (!input || typeof input !== 'string') return input;
  // 將 Windows/Mac 換行統一為 \n
  let text = input.replace(/\r\n?|\u2028|\u2029/g, '\n');
  // 以換行拆分、修剪每行前後空白、過濾空行
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  // 將多行以單一空格串接
  text = lines.join(' ');
  // 將連續空白壓成單一空白
  text = text.replace(/\s{2,}/g, ' ');
  // 移除純中文之間的空白（避免 OCR 斷行產生的多餘空格）
  text = text.replace(/([\u4E00-\u9FFF])\s+([\u4E00-\u9FFF])/g, '$1$2');
  // 英文逗號改為全形逗號（但保留數字中的逗號，如 1,000,000）
  // 使用負向先行斷言，確保逗號前後不是數字
  text = text.replace(/(?<!\d),(?!\d)/g, '，');
  // 英文分號改為全形分號
  text = text.replace(/;/g, '；');
  return text.trim();
}

// 解析使用者修改的回應內容
function parseModifiedResponses(messageText) {
  if (!messageText || typeof messageText !== 'string') return {};
  
  const result = {};
  
  // 檢查是否包含確認格式的內容
  if (messageText.includes('📋 請確認你的回答：') || messageText.includes('- 部會：') || messageText.includes('- 預算科目：')) {
    // 解析格式化的回應
    const lines = messageText.split('\n');
    
    for (const line of lines) {
      if (line.includes('- 部會：')) {
        const value = line.replace('- 部會：', '').trim();
        result.department = value === 'unclear' ? null : value;
      } else if (line.includes('- 預算科目：')) {
        const value = line.replace('- 預算科目：', '').trim();
        result.budget_subject = value === 'unclear' ? null : value;
      } else if (line.includes('- 預算金額：')) {
        const value = line.replace('- 預算金額：', '').trim();
        result.budget_amount = value === 'unclear' ? null : value;
      } else if (line.includes('- 提案類型：')) {
        const actionType = line.replace('- 提案類型：', '').trim();
        result.action_type = actionType === 'unclear' ? null : actionType;
      } else if (line.includes('- 減列金額：')) {
        const value = line.replace('- 減列金額：', '').trim();
        result.reduction_amount = (value === 'null' || value === '0') ? null : value;
      } else if (line.includes('- 凍結金額：')) {
        const value = line.replace('- 凍結金額：', '').trim();
        result.freeze_amount = (value === 'null' || value === '0') ? null : value;
      } else if (line.includes('- 提案人：')) {
        const value = line.replace('- 提案人：', '').trim();
        result.proposer = value === 'unclear' ? null : value;
      } else if (line.includes('- 連署人：')) {
        const value = line.replace('- 連署人：', '').trim();
        result.co_signers = value === 'unclear' ? null : value;
      }
    }
  }
  
  return result;
}


// 創建快速回覆
function createQuickReply(question, extraQuickReplyActions = []) {
  const hasQuickReplyOptions = Array.isArray(question.options) && question.options.length > 0;
  const buildQuickReplyItems = () => {
    const optionItems = hasQuickReplyOptions
      ? question.options.map(option => ({
          type: 'action',
          action: {
            type: 'message',
            label: option.label,
            text: option.value
          }
        }))
      : [];
    return [...optionItems, ...extraQuickReplyActions];
  };

  const baseMessage = {
    type: 'text',
    text: question.text || '請回答這個問題'
  };

  if (question.type === 'mixed_input' || question.type === 'quick_reply') {
    const items = buildQuickReplyItems();
    if (items.length > 0) {
      baseMessage.quickReply = { items };
    }
    return baseMessage;
  }

  if (question.type === 'text' || question.type === 'free_text' || !hasQuickReplyOptions) {
    if (extraQuickReplyActions.length > 0) {
      baseMessage.quickReply = { items: extraQuickReplyActions };
    }
    return baseMessage;
  }

  if (question.type === 'instruction') {
    if (extraQuickReplyActions.length > 0) {
      baseMessage.quickReply = { items: extraQuickReplyActions };
    }
    return baseMessage;
  }

  const items = buildQuickReplyItems();
  if (items.length > 0) {
    baseMessage.quickReply = { items };
  }
  return baseMessage;
}

function createProposalReasonGuideImageMessage() {
  return {
    type: 'image',
    originalContentUrl: PROPOSAL_REASON_GUIDE_IMAGE_URL,
    previewImageUrl: PROPOSAL_REASON_GUIDE_IMAGE_URL
  };
}

function createQuestionMessages(question) {
  const messages = [];
  messages.push(createQuickReply(question));
  if (question.id === 'proposal_reason') {
    messages.push(createProposalReasonGuideImageMessage());
  }
  return messages;
}

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !privateKey) {
    console.warn('Feedback Google Sheets credentials are not fully configured.');
    return null;
  }
  sheetsClient = new google.auth.JWT(
    email,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  return sheetsClient;
}

async function appendFeedbackRow(issue, wantsReply, contact, userId) {
  const auth = getSheetsClient();
  if (!auth) {
    throw new Error('尚未設定 Google Sheets 認證');
  }
  await auth.authorize();
  const sheets = google.sheets({ version: 'v4', auth });
  const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const values = [[timestamp, issue, wantsReply ? '是' : '否', contact || '（未留下）', userId]];
  await sheets.spreadsheets.values.append({
    spreadsheetId: FEEDBACK_SPREADSHEET_ID,
    range: FEEDBACK_SHEET_RANGE,
    valueInputOption: 'RAW',
    resource: { values }
  });
}

function createFeedbackNeedReplyTemplate() {
  return {
    type: 'template',
    altText: '需要我們回覆嗎？',
    template: {
      type: 'buttons',
      text: '需要我們回覆你嗎？若是操作問題或 bug，可以留下聯繫方式讓我們跟你聯繫。',
      actions: [
        { type: 'message', label: '需要', text: 'feedback_need_reply_yes' },
        { type: 'message', label: '不需要', text: 'feedback_need_reply_no' }
      ]
    }
  };
}

async function handleFeedbackSession(userId, replyToken, messageText) {
  const session = feedbackSessions.get(userId);
  if (!session) return false;
  const trimmed = (messageText || '').trim();
  if (trimmed === FEEDBACK_CANCEL_COMMAND) {
    feedbackSessions.delete(userId);
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '已取消回報流程，如有其他問題歡迎再提醒我。'
    });
    return true;
  }

  if (session.stage === FEEDBACK_STATE.ISSUE) {
    if (!trimmed) {
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '提醒你要描述想回報的內容喔！'
      });
      return true;
    }
    session.issue = trimmed;
    session.stage = FEEDBACK_STATE.NEED_REPLY;
    feedbackSessions.set(userId, session);
    await client.replyMessage(replyToken, createFeedbackNeedReplyTemplate());
    return true;
  }

  if (session.stage === FEEDBACK_STATE.NEED_REPLY) {
    if (trimmed === 'feedback_need_reply_yes') {
      session.wantsReply = true;
      session.stage = FEEDBACK_STATE.CONTACT;
      feedbackSessions.set(userId, session);
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '好的！請留下聯繫方式（建議提供 Email 或其他方便的方式）。'
      });
      return true;
    }
    if (trimmed === 'feedback_need_reply_no') {
      try {
        await appendFeedbackRow(session.issue, false, '', userId);
        feedbackSessions.delete(userId);
        await client.replyMessage(replyToken, {
          type: 'text',
          text: '✅ 已收到你的回報，我們會參考改善，謝謝你！'
        });
      } catch (error) {
        console.error('❌ 寫入回報 Google Sheets 失敗:', error.message);
        exitFeedbackSession(userId);
        await client.replyMessage(replyToken, {
          type: 'text',
          text: '❌ 目前暫時無法紀錄回報，再等等我或稍後再試一次，可以嗎？'
        });
      }
      return true;
    }
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '請點選【需要】或【不需要】按鈕，我就能知道該怎麼回覆你。'
    });
    return true;
  }

  if (session.stage === FEEDBACK_STATE.CONTACT) {
    if (!trimmed) {
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '看起來你沒有輸入聯繫方式，再試一次就好！'
      });
      return true;
    }
    try {
      await appendFeedbackRow(session.issue, true, trimmed, userId);
      feedbackSessions.delete(userId);
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '✅ 已收到你的回報，我們會盡快追蹤並回覆。謝謝你幫助我們讓體驗更好！'
      });
    } catch (error) {
      console.error('❌ 寫入回報 Google Sheets 失敗:', error.message);
      exitFeedbackSession(userId);
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '❌ 目前暫時無法紀錄回報，再等等我或稍後再試一次，可以嗎？'
      });
    }
    return true;
  }

  return false;
}

// 創建歡迎訊息（純文字）
function createWelcomeMessage() {
  return {
    type: 'text',
    text: '歡迎加入預算提案單協作的行列！手機版請點選下列選單的不同功能來開始，電腦版請隨意傳送文字，即可獲得選單。若你是第一次聽說這個專案，請點擊「查看教學」或前往 www.ooo.com 查看。'
  };
}

// 創建主選單輪播（電腦版無 Rich Menu 時使用）
function createMainMenuCarousel() {
  return {
    type: 'template',
    altText: '主選單',
    template: {
      type: 'carousel',
      columns: [
        {
          thumbnailImageUrl: 'https://github.com/Citizen-Congress-Watch/budget_linebot/blob/main/image/menu1.png?raw=true',
          text: '點選辨識按鈕，開始協作。',
          actions: [
            { type: 'message', label: '開始辨識', text: '開始辨識' }
          ]
        },
        {
          thumbnailImageUrl: 'https://github.com/Citizen-Congress-Watch/budget_linebot/blob/main/image/menu2.png?raw=true',
          text: '點選驗證按鈕，開始協作。',
          actions: [
            { type: 'message', label: '開始驗證', text: '開始驗證' }
          ]
        },
        {
          thumbnailImageUrl: 'https://github.com/Citizen-Congress-Watch/budget_linebot/blob/main/image/menu3.png?raw=true',
          text: '查看教學內容。',
          actions: [
            { type: 'message', label: '查看教學', text: '查看教學' }
          ]
        },
        {
          thumbnailImageUrl: 'https://github.com/Citizen-Congress-Watch/budget_linebot/blob/main/image/menu4.png?raw=true',
          text: '查看計畫緣起網站',
          actions: [
            { type: 'message', label: '這個專案在做什麼', text: '暸解計劃緣起' }
          ]
        },
        {
          thumbnailImageUrl: 'https://github.com/Citizen-Congress-Watch/budget_linebot/blob/main/image/menu5.png?raw=true',
          text: '遇到問題或有建議嗎？',
          actions: [
            { type: 'message', label: '回報問題', text: '回報問題' }
          ]
        }
      ]
    }
  };
}

const TUTORIAL_BLOCKED_OPTION_VALUES = ['skip_image', 'unclear'];
const TUTORIAL_JUMP_OUT_ACTION = {
  type: 'action',
  action: {
    type: 'message',
    label: '跳出教學',
    text: '跳出'
  }
};
const PROPOSAL_REASON_GUIDE_IMAGE_URL = 'https://github.com/Citizen-Congress-Watch/budget_linebot/blob/main/image/PROPOSAL_REASON_GUIDE_IMAGE.png?raw=true';
const TUTORIAL_INTRO_IMAGE_URL = 'https://github.com/Citizen-Congress-Watch/budget_linebot/blob/main/image/TUTORIAL_INTRO_IMAGE.png?raw=true';
const FEEDBACK_PROMPT_TEXT = '🙋‍♀️ 回報問題\n\n請輸入你想回報的問題或意見，輸入完成後再傳送給我。\n如果想退出回報流程，輸入「取消回報」即可。';
const FEEDBACK_SPREADSHEET_ID = process.env.FEEDBACK_SPREADSHEET_ID;
const FEEDBACK_SHEET_RANGE = process.env.FEEDBACK_SHEET_RANGE;
if (!FEEDBACK_SPREADSHEET_ID || !FEEDBACK_SHEET_RANGE) {
  throw new Error('FEEDBACK_SPREADSHEET_ID 與 FEEDBACK_SHEET_RANGE 必須設定於環境變數');
}
const FEEDBACK_CANCEL_COMMAND = '取消回報';
const FEEDBACK_STATE = {
  ISSUE: 'issue',
  NEED_REPLY: 'need_reply',
  CONTACT: 'contact'
};
const feedbackSessions = new Map();
let sheetsClient = null;
function exitFeedbackSession(userId) {
  if (feedbackSessions.has(userId)) {
    feedbackSessions.delete(userId);
    console.log('📮 使用者已離開回報流程（觸發其他功能）');
  }
}
const FEEDBACK_EXIT_COMMANDS = new Set([
  '開始辨識',
  '開始驗證',
  '查看教學',
  '暸解計劃緣起',
  '學習辨識流程',
  '學習驗證流程',
  '跳出'
]);

function createTutorialEntryMessages() {
  return [
    {
      type: 'text',
      text: '🎓 你好！我們即將進入教學模式，會帶你逐題練習辨識或驗證流程，回答正確才能前往下一題。點選「跳出」按鈕、或點選主選單的其他選項即可離開。\n\n你可以先透過這張圖片暸解預算提案單的各個欄位，這些會是機器人即將問你的問題。點選辨識或驗證來開始學習吧！'
    },
    {
      type: 'image',
      originalContentUrl: TUTORIAL_INTRO_IMAGE_URL,
      previewImageUrl: TUTORIAL_INTRO_IMAGE_URL
    },
    createTutorialMenu()
  ];
}

function createTutorialMenu() {
  return {
    type: 'template',
    altText: '教學模式選單',
    template: {
      type: 'buttons',
      text: '請選擇想要練習的流程：',
      actions: [
        { type: 'message', label: '學習辨識流程', text: '學習辨識流程' },
        { type: 'message', label: '學習驗證流程', text: '學習驗證流程' }
      ]
    }
  };
}

function createTutorialIntroMessage(tutorialLabel) {
  return {
    type: 'text',
    text: `🎓 ${tutorialLabel}\n\n接下來會用一張示範提案單，帶你一步步完成流程。每題答對才會繼續前進，點選「跳出」按鈕或點擊主選單即可離開教學模式。`
  };
}

function createTutorialQuestionMessages(question, tutorialLabel) {
  const tutorialQuestion = {
    ...question,
    text: `🎓 ${tutorialLabel}\n\n${question.text}`
  };

  if (Array.isArray(question.options)) {
    tutorialQuestion.options = question.options.filter(
      option => !TUTORIAL_BLOCKED_OPTION_VALUES.includes(option.value)
    );
  }

  const messages = [];
  messages.push(createQuickReply(tutorialQuestion, [TUTORIAL_JUMP_OUT_ACTION]));
  if (question.id === 'proposal_reason') {
    messages.push(createProposalReasonGuideImageMessage());
  }
  return messages;
}

function createTutorialExitMessage(tutorialLabel) {
  return {
    type: 'text',
    text: `👋 已離開${tutorialLabel}，想再練習時輸入「查看教學」即可重新開始。`
  };
}

function createTutorialCompletionMessages(mode) {
  const label = tutorialHelper.getTutorialLabel(mode);
  const baseMode = tutorialHelper.getBaseMode(mode) || 'recognition';
  const retryText = baseMode === 'verification' ? '學習驗證流程' : '學習辨識流程';
  const otherTutorialText = baseMode === 'verification' ? '學習辨識流程' : '學習驗證流程';

  return [
    {
      type: 'text',
      text: `🎉 ${label}完成！你已經完成一次完整流程，歡迎開始正式協作。`
    },
    {
      type: 'template',
      altText: '下一步選擇',
      template: {
        type: 'buttons',
        text: '接下來想做什麼？',
        actions: [
          { type: 'message', label: '開始辨識', text: '開始辨識' },
          { type: 'message', label: '開始驗證', text: '開始驗證' },
          { type: 'message', label: '再練習一次教學模式', text: retryText },
          { type: 'message', label: otherTutorialText, text: otherTutorialText }
        ]
      }
    }
  ];
}

function createTutorialVerificationSummaryMessages(responses, tutorialLabel) {
  const confirmationText = createConfirmationTextWithoutProposal(responses);
  return [
    {
      type: 'text',
      text: `🎓 ${tutorialLabel}\n\n以下是其他協作者填寫的資料：\n\n${confirmationText}`,
      quickReply: {
        items: [TUTORIAL_JUMP_OUT_ACTION]
      }
    },
    {
      type: 'template',
      altText: '教學：請確認資料是否正確',
      template: {
        type: 'buttons',
        text: '請判斷以上資料是否正確？',
        actions: [
          { type: 'message', label: '✅ 資料正確', text: 'verify_first_stage_correct' },
          { type: 'message', label: '❌ 有錯誤', text: 'verify_first_stage_wrong' }
        ]
      }
    }
  ];
}

function createTutorialVerificationReasonMessages(responses, tutorialLabel) {
  const reason = responses.proposal_reason || '';
  return [
    {
      type: 'text',
      text: `🎓 ${tutorialLabel}\n\n📝 案由：\n\n${reason}`,
      quickReply: {
        items: [TUTORIAL_JUMP_OUT_ACTION]
      }
    },
    {
      type: 'template',
      altText: '教學：請確認案由是否正確',
      template: {
        type: 'buttons',
        text: '案由內容正確嗎？',
        actions: [
          { type: 'message', label: '✅ 案由正確', text: 'verify_second_stage_correct' },
          { type: 'message', label: '❌ 案由錯誤', text: 'verify_second_stage_wrong' }
        ]
      }
    }
  ];
}

function createTutorialVerificationCorrectionMessages(incorrectResponses, tutorialLabel) {
  const confirmationText = createConfirmationTextWithoutProposal(incorrectResponses);
  return [
    {
      type: 'text',
      text: `🎓 ${tutorialLabel}\n\n以下是其他協作者填寫的資料：\n\n${confirmationText}\n\n請複製整段文字、修正欲修改的欄位後傳回來。`,
      quickReply: {
        items: [TUTORIAL_JUMP_OUT_ACTION]
      }
    }
  ];
}

function buildTutorialVerificationStageMessages(session, stageIndex) {
  const responses = session.responses || {};
  const tutorialLabel = tutorialHelper.getTutorialLabel(session.mode);
  const stages = tutorialHelper.getTutorialVerificationStages();
  const stage = stages[stageIndex];

  if (stage && stage.type === 'correction') {
    if (session.tutorialShowCorrection) {
      const incorrect = session.tutorialIncorrectResponses || tutorialHelper.getVerificationIncorrectResponses();
      return createTutorialVerificationCorrectionMessages(incorrect, tutorialLabel);
    }
    return createTutorialVerificationSummaryMessages(responses, tutorialLabel);
  }

  if (stage && stage.type === 'confirmation') {
    if (stageIndex === 0) {
      return createTutorialVerificationSummaryMessages(responses, tutorialLabel);
    }
    return createTutorialVerificationReasonMessages(responses, tutorialLabel);
  }

  if (stageIndex === 0) {
    return createTutorialVerificationSummaryMessages(responses, tutorialLabel);
  }
  return createTutorialVerificationReasonMessages(responses, tutorialLabel);
}

function sendTutorialVerificationStage(userId, replyToken, session, stageIndex, prependMessage = null) {
  const stageMessages = buildTutorialVerificationStageMessages(session, stageIndex);
  if (!stageMessages || stageMessages.length === 0) {
    console.error('❌ 找不到教學驗證階段訊息');
    sessionManager.clearSession(userId);
    return client.replyMessage(replyToken, {
      type: 'text',
      text: '❌ 教學流程設定有誤，請稍後再試。'
    });
  }

  const messages = [];
  if (prependMessage) {
    if (Array.isArray(prependMessage)) {
      messages.push(...prependMessage);
    } else {
      messages.push(prependMessage);
    }
  }
  messages.push(...stageMessages);

  return client.replyMessage(replyToken, messages);
}

function sendTutorialQuestion(userId, replyToken, session, questionId, prependMessage = null) {
  const question = QUESTIONS.find(q => q.id === questionId);
  if (!question) {
    console.error(`❌ 找不到教學題目 ${questionId}`);
    sessionManager.clearSession(userId);
    return client.replyMessage(replyToken, {
      type: 'text',
      text: '❌ 找不到教學題目設定，請輸入「查看教學」重新開始。'
    });
  }

  sessionManager.updateSession(userId, { tutorialCurrentQuestionId: questionId });

  const questionMessages = createTutorialQuestionMessages(
    question,
    tutorialHelper.getTutorialLabel(session.mode)
  );

  const messages = [];
  if (prependMessage) {
    if (Array.isArray(prependMessage)) {
      messages.push(...prependMessage);
    } else {
      messages.push(prependMessage);
    }
  }
  messages.push(...questionMessages);

  return client.replyMessage(replyToken, messages);
}

async function startTutorialFlow(userId, replyToken, tutorialType) {
  const tutorialMode = tutorialType === 'verification' ? 'tutorial_verification' : 'tutorial_recognition';
  const baseMode = tutorialHelper.getBaseMode(tutorialMode);
  try {
    const tutorialImage = await keystoneAPI.getPhotoById(tutorialHelper.TUTORIAL_IMAGE_ID);
    if (!tutorialImage) {
      console.error('❌ 取得教學圖片失敗');
      return client.replyMessage(replyToken, {
        type: 'text',
        text: '❌ 目前無法載入教學圖片，請稍後再試。'
      });
    }

    const tutorialLabel = tutorialHelper.getTutorialLabel(tutorialMode);

    if (baseMode === 'verification') {
      const verificationStages = tutorialHelper.getTutorialVerificationStages();
      if (!verificationStages || verificationStages.length === 0) {
        console.error('❌ 驗證教學階段尚未設定');
        return client.replyMessage(replyToken, {
          type: 'text',
          text: '❌ 驗證教學尚未設定，請通知系統管理者。'
        });
      }

      const sampleStatusId = tutorialHelper.getVerificationSampleId();
      const tutorialStatus = await keystoneAPI.getRecognitionStatusById(sampleStatusId);
      if (!tutorialStatus || !tutorialStatus.image) {
        console.error('❌ 找不到教學用的 Recognition Status 或圖片');
        return client.replyMessage(replyToken, {
          type: 'text',
          text: '❌ 目前無法載入教學資料，請稍後再試。'
        });
      }

      const correctResponses = convertRecognitionStatusToQuestions(tutorialStatus);
      const incorrectResponses = tutorialHelper.getVerificationIncorrectResponses();

    sessionManager.startQuiz(userId, tutorialStatus.image, tutorialMode, correctResponses, {
      isTutorial: true,
      tutorialFlow: [],
      tutorialStep: 0,
      tutorialStage: 0,
      tutorialIncorrectResponses: incorrectResponses,
      tutorialShowCorrection: false
    });

      const stageMessages = buildTutorialVerificationStageMessages(
        sessionManager.getSession(userId),
        0
      );

      return client.replyMessage(replyToken, [
        createTutorialIntroMessage(tutorialLabel),
        {
          type: 'image',
          originalContentUrl: tutorialStatus.image.imageUrl,
          previewImageUrl: tutorialStatus.image.imageUrl
        },
        ...stageMessages
      ]);
    }

    const tutorialFlow = tutorialHelper.getTutorialFlow(tutorialMode);

    if (!tutorialFlow || tutorialFlow.length === 0) {
      console.error('❌ 教學流程尚未設定');
      return client.replyMessage(replyToken, {
        type: 'text',
        text: '❌ 教學流程尚未設定，請通知系統管理者。'
      });
    }

    sessionManager.startQuiz(userId, tutorialImage, tutorialMode, {}, {
      isTutorial: true,
      tutorialFlow,
      tutorialStep: 0,
      tutorialCurrentQuestionId: tutorialFlow[0] || null
    });

    const messages = [
      createTutorialIntroMessage(tutorialLabel),
      {
        type: 'image',
        originalContentUrl: tutorialImage.imageUrl,
        previewImageUrl: tutorialImage.imageUrl
      }
    ];

    const firstQuestionId = tutorialFlow[0];
    if (firstQuestionId) {
      const firstQuestion = QUESTIONS.find(q => q.id === firstQuestionId);
      if (firstQuestion) {
        messages.push(...createTutorialQuestionMessages(firstQuestion, tutorialLabel));
      } else {
        console.error(`❌ 找不到教學題目 ${firstQuestionId}`);
        messages.push({
          type: 'text',
          text: '❌ 找不到教學題目設定，請稍後再試。'
        });
      }
    }

    return client.replyMessage(replyToken, messages);
  } catch (error) {
    console.error('❌ 啟動教學模式失敗:', error);
    return client.replyMessage(replyToken, {
      type: 'text',
      text: '❌ 無法啟動教學模式，請稍後再試。'
    });
  }
}

async function handleTutorialResponse(event, session, messageText) {
  const userId = event.source.userId;
  const baseMode = tutorialHelper.getBaseMode(session.mode);

  if (baseMode === 'verification') {
    return handleTutorialVerificationResponse(event, session, messageText);
  }

  const tutorialLabel = tutorialHelper.getTutorialLabel(session.mode);
  const flow = session.tutorialFlow && session.tutorialFlow.length > 0
    ? session.tutorialFlow
    : tutorialHelper.getTutorialFlow(session.mode);

  if (!flow || flow.length === 0) {
    console.error('❌ 教學流程不存在，結束教學');
    sessionManager.clearSession(userId);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '❌ 教學流程設定有誤，請輸入「查看教學」重新開始。'
    });
  }

  const tutorialStep = session.tutorialStep || 0;

  if (tutorialStep >= flow.length) {
    sessionManager.clearSession(userId);
    return client.replyMessage(event.replyToken, createTutorialCompletionMessages(session.mode));
  }

  const questionId = flow[tutorialStep];
  const question = QUESTIONS.find(q => q.id === questionId);

  if (!question) {
    console.error(`❌ 找不到教學題目 ${questionId}`);
    sessionManager.clearSession(userId);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '❌ 教學題目設定有誤，請稍後再試。'
    });
  }

  let finalAnswer = (messageText || '').trim();

  if (!finalAnswer) {
    const questionMessages = createTutorialQuestionMessages(question, tutorialLabel);
    return client.replyMessage(event.replyToken, [
      {
        type: 'text',
        text: '請先輸入答案，再送出喔！'
      },
      ...questionMessages
    ]);
  }

  if (question.id === 'proposal_reason') {
    finalAnswer = normalizeProposalReason(finalAnswer);
  }

  if (question.id === 'reduction_amount' || question.id === 'freeze_amount') {
    const mathResult = safeMathEval(finalAnswer);
    if (mathResult !== null) {
      finalAnswer = mathResult.toString();
    }
  }

  const validation = tutorialHelper.validateTutorialAnswer(session.mode, question.id, finalAnswer, safeMathEval);

  if (!validation.isCorrect) {
    const questionMessages = createTutorialQuestionMessages(question, tutorialLabel);
    return client.replyMessage(event.replyToken, [
      {
        type: 'text',
        text: validation.message || `❌ ${tutorialHelper.getQuestionLabel(question.id)}的答案還不太對，不急，我們再一起檢查一次！`
      },
      ...questionMessages
    ]);
  }

  const updatedResponses = {
    ...(session.responses || {}),
    [question.id]: validation.normalizedAnswer ?? finalAnswer
  };

  sessionManager.updateSession(userId, {
    responses: updatedResponses,
    tutorialStep: tutorialStep + 1
  });

  const encouragementMessages = [
    '你越來越上手啦！',
    '太棒了，進步神速！',
    '好厲害，繼續保持！',
    '答得真準確！',
    '你的觀察力真敏銳！',
    '越來越熟悉流程了！',
    '表現超級出色！',
    '你的細心讓一切更完美！',
    '答對了，繼續加油！',
    '你對預算的了解越來越深入了！'
  ];

  const randomEncouragement = encouragementMessages[Math.floor(Math.random() * encouragementMessages.length)];

  const successMessage = {
    type: 'text',
    text: `✅ ${tutorialHelper.getQuestionLabel(question.id)}答對了！${randomEncouragement}`
  };

  if (tutorialStep + 1 >= flow.length) {
    sessionManager.clearSession(userId);
    const completionMessages = createTutorialCompletionMessages(session.mode);
    return client.replyMessage(event.replyToken, [successMessage, ...completionMessages]);
  }

  const updatedSession = sessionManager.getSession(userId);
  const nextQuestionId = flow[tutorialStep + 1];
  return sendTutorialQuestion(userId, event.replyToken, updatedSession, nextQuestionId, successMessage);
}

function handleTutorialVerificationResponse(event, session, messageText) {
  const userId = event.source.userId;
  const stages = tutorialHelper.getTutorialVerificationStages();
  const stageIndex = session.tutorialStage || 0;

  if (!stages || stageIndex >= stages.length) {
    sessionManager.clearSession(userId);
    return client.replyMessage(event.replyToken, createTutorialCompletionMessages(session.mode));
  }

  const stage = stages[stageIndex];
  if (stage.type === 'correction') {
    return handleTutorialVerificationCorrectionStage(event, session, messageText, stage);
  }
  const trimmedAnswer = (messageText || '').trim();
  const correctResponses = stage.correctResponses || (stage.correctResponse ? [stage.correctResponse] : []);
  let isCorrect = correctResponses.length === 0 || correctResponses.includes(trimmedAnswer);

  if (!isCorrect && stage.type === 'confirmation' && trimmedAnswer) {
    const normalizedReason = normalizeProposalReason(trimmedAnswer);
    const reasonValidation = tutorialHelper.validateTutorialAnswer(
      session.mode,
      'proposal_reason',
      normalizedReason,
      safeMathEval
    );

    if (reasonValidation.isCorrect) {
      isCorrect = true;
      sessionManager.updateSession(userId, {
        responses: {
          ...session.responses,
          proposal_reason: reasonValidation.normalizedAnswer ?? normalizedReason
        }
      });
    }
  }

  if (!isCorrect) {
    const failureMessage = stage.failureMessage || '❌ 回答不正確，請依提示重新選擇。';
    return sendTutorialVerificationStage(
      userId,
      event.replyToken,
      session,
      stageIndex,
      { type: 'text', text: failureMessage }
    );
  }

  const successMessage = {
    type: 'text',
    text: stage.successMessage || '✅ 完成！'
  };

  if (stageIndex + 1 >= stages.length) {
    if (session.isTutorial && session.mode === 'tutorial_verification') {
      sessionManager.clearSession(userId);
      const completionMessages = createTutorialCompletionMessages(session.mode);
      return client.replyMessage(event.replyToken, [successMessage, ...completionMessages]);
    }
    sessionManager.clearSession(userId);
    const completionMessages = createTutorialCompletionMessages(session.mode);
    return client.replyMessage(event.replyToken, [successMessage, ...completionMessages]);
  }

  sessionManager.updateSession(userId, { tutorialStage: stageIndex + 1 });
  const updatedSession = sessionManager.getSession(userId);
  return sendTutorialVerificationStage(
    userId,
    event.replyToken,
    updatedSession,
    stageIndex + 1,
    successMessage
  );
}

function handleTutorialVerificationCorrectionStage(event, session, messageText, stage) {
  const userId = event.source.userId;
  const tutorialLabel = tutorialHelper.getTutorialLabel(session.mode);
  const incorrectResponses = session.tutorialIncorrectResponses || tutorialHelper.getVerificationIncorrectResponses();
  const modifiedData = parseModifiedResponses(messageText);
  if (!modifiedData || Object.keys(modifiedData).length === 0) {
    const reminder = {
      type: 'text',
      text: '❌ 沒有抓到你的修改內容，請先複製整段資料並逐項修正後貼回。'
    };
    return sendTutorialVerificationStage(
      userId,
      event.replyToken,
      session,
      session.tutorialStage || 0,
      reminder
    );
  }

  const mergedResponses = { ...incorrectResponses, ...modifiedData };
  const fieldsToCheck = [
    'department',
    'budget_subject',
    'budget_amount',
    'action_type',
    'reduction_amount',
    'freeze_amount',
    'proposal_reason',
    'proposer',
    'co_signers'
  ];

  for (const field of fieldsToCheck) {
    if (field === 'proposal_reason' && mergedResponses[field]) {
      mergedResponses[field] = normalizeProposalReason(mergedResponses[field]);
    }

    const validation = tutorialHelper.validateTutorialAnswer(
      session.mode,
      field,
      mergedResponses[field],
      safeMathEval
    );

    if (!validation.isCorrect) {
      return sendTutorialVerificationStage(
        userId,
        event.replyToken,
        session,
        session.tutorialStage || 0,
        {
          type: 'text',
          text: validation.message || stage.failureMessage || '❌ 還有欄位不正確，請再次修正。'
        }
      );
    }

    mergedResponses[field] = validation.normalizedAnswer ?? mergedResponses[field];
  }

  sessionManager.updateSession(userId, {
    responses: {
      ...session.responses,
      ...mergedResponses
    },
    tutorialStage: (session.tutorialStage || 0) + 1,
    tutorialIncorrectResponses: mergedResponses,
    tutorialShowCorrection: false
  });

  const successMessage = {
    type: 'text',
    text: stage.successMessage || `✅ ${tutorialHelper.getQuestionLabel(fieldsToCheck[0])}修正完成！`
  };

  const updatedSession = sessionManager.getSession(userId);
  return sendTutorialVerificationStage(
    userId,
    event.replyToken,
    updatedSession,
    updatedSession.tutorialStage,
    successMessage
  );
}

// 創建確認文字（不含案由）
function createConfirmationTextWithoutProposal(responses) {
  const fields = [
    { label: '部會', value: responses.department },
    { label: '預算科目', value: responses.budget_subject },
    { label: '預算金額', value: responses.budget_amount },
    { label: '提案類型', value: responses.action_type },
    { label: '減列金額', value: responses.reduction_amount },
    { label: '凍結金額', value: responses.freeze_amount },
    { label: '提案人', value: responses.proposer },
    { label: '連署人', value: responses.co_signers }
  ];

  return fields
    .map(field => {
      // 為空值提供適當的預設值
      let displayValue = field.value;
      if (field.value === null || field.value === undefined || field.value === '') {
        if (field.label === '減列金額' || field.label === '凍結金額') {
          displayValue = '0';
        } else {
          displayValue = 'unclear';
        }
      }
      return `- ${field.label}：${displayValue}`;
    })
    .join('\n');
}

// 驗證模式輸入驗證
function validateVerificationInput(questionId, value) {
  switch (questionId) {
    case 'action_type':
      const validTypes = ['減列', '凍結', '減列＋凍結', '主決議', '不確定'];
      if (!validTypes.includes(value)) {
        return { isValid: false, message: '提案類型必須是：減列、凍結、減列＋凍結、主決議或不確定' };
      }
      return { isValid: true, value };
    
    case 'reduction_amount':
    case 'freeze_amount':
      if (value === 'unclear') return { isValid: true, value };
      const num = parseFloat(value);
      if (isNaN(num) || num < 0) {
        return { isValid: false, message: '金額必須是有效的數字' };
      }
      return { isValid: true, value: num.toString() };
    
    default:
      return { isValid: true, value };
  }
}

// 將 Recognition Status 轉換為問題格式
function convertRecognitionStatusToQuestions(recognitionStatus) {
  // 將英文的 action_type 轉換為中文
  const actionTypeMapping = {
    'reduce': '減列',
    'freeze': '凍結',
    'reduce_and_freeze': '減列＋凍結',
    'suggestion': '主決議',
    'uncertain': '不確定'
  };
  
  const originalActionType = recognitionStatus.budgetTypeResult || '';
  const actionType = actionTypeMapping[originalActionType] || originalActionType;
  
  return {
    department: recognitionStatus.governmentBudgetResult || '',
    budget_subject: recognitionStatus.budgetCategoryResult || '',
    budget_amount: recognitionStatus.budgetAmountResult || '',
    action_type: actionType,
    reduction_amount: recognitionStatus.reductionAmountResult || '',
    freeze_amount: recognitionStatus.freezeAmountResult || '',
    proposal_reason: normalizeProposalReason(recognitionStatus.reason || ''),
    proposer: recognitionStatus.proposers || '',
    co_signers: recognitionStatus.coSigners || ''
  };
}

// 處理事件
async function handleEvent(event) {
  try {
    console.log(`🔍 收到事件類型: ${event.type}`);
    console.log(`使用者: ${event.source.userId}`);

    // 處理加入好友事件
    if (event.type === 'follow') {
      console.log('👋 新使用者加入好友');
      return client.replyMessage(event.replyToken, createWelcomeMessage());
    }

    // 處理文字訊息事件
    if (event.type !== 'message' || event.message.type !== 'text') {
      return Promise.resolve(null);
    }

    const userId = event.source.userId;
    const messageText = event.message.text;

    // 處理查看教學指令 - 在任何狀態下都能觸發，並中斷原本的流程
    if (messageText === '查看教學') {
      console.log('📚 使用者輸入查看教學，顯示教學模式選單');
      sessionManager.clearSession(userId);
      return client.replyMessage(event.replyToken, createTutorialEntryMessages());
    }

    if (messageText === '學習辨識流程') {
      console.log('🎓 使用者選擇辨識教學模式');
      sessionManager.clearSession(userId);
      return startTutorialFlow(userId, event.replyToken, 'recognition');
    }

    if (messageText === '學習驗證流程') {
      console.log('🎓 使用者選擇驗證教學模式');
      sessionManager.clearSession(userId);
      return startTutorialFlow(userId, event.replyToken, 'verification');
    }

    if (messageText === '暸解計劃緣起') {
      console.log('💡 顯示計劃緣起');
      return client.replyMessage(event.replyToken, {
        type: 'template',
        altText: '中央政府總預算案審查監督平台',
        template: {
          type: 'buttons',
          text: '💡 計劃緣起\n\n本專案旨在透過群眾協作的方式，協助辨識和驗證政府預算提案單的內容，提升預算透明度，讓民眾更容易理解政府預算的運用。\n\n🎯 透過您的參與，我們可以建立更完整的預算資料庫，促進政府預算的公開透明。',
          actions: [
            {
              type: 'uri',
              label: '查看完整平台',
              uri: 'https://www.readr.tw/project/3/2025budget/'
            }
          ]
        }
      });
    }

    if (messageText === '開始辨識') {
      console.log('🚀 開始辨識模式');
      try {
        const photo = await keystoneAPI.getRandomPhoto(userId);
        if (!photo) {
          return client.replyMessage(event.replyToken, {
            type: 'text',
            text: '📭 現在已經沒有需要辨識的圖片了！要不要再試試別的？',
            quickReply: {
              items: [
                {
                  type: 'action',
                  action: {
                    type: 'message',
                    label: '✅ 驗證模式',
                    text: '開始驗證'
                  }
                }
              ]
            }
          });
        }

        sessionManager.startQuiz(userId, photo, 'recognition');
        
        const imageMessage = {
          type: 'image',
          originalContentUrl: photo.imageUrl,
          previewImageUrl: photo.imageUrl
        };

        const firstQuestion = QUESTIONS[0];
        const questionMessages = createQuestionMessages(firstQuestion);

        return client.replyMessage(event.replyToken, [imageMessage, ...questionMessages]);
      } catch (error) {
        console.error('❌ 開始辨識模式時發生錯誤:', error);
      return client.replyMessage(event.replyToken, {
        type: 'text',
          text: '❌ 開始辨識模式時發生錯誤，請稍後再試。'
        });
      }
    }

    if (messageText === '開始驗證') {
      console.log('🚀 開始驗證模式');
      try {
        const recognitionStatus = await keystoneAPI.getRandomRecognitionStatus(userId);
        if (!recognitionStatus) {
          return client.replyMessage(event.replyToken, {
            type: 'text',
            text: '📭 現在已經沒有需要驗證的圖片了！要不要再試試別的？',
            quickReply: {
              items: [
                {
                  type: 'action',
                  action: {
                    type: 'message',
                    label: '🔍 辨識模式',
                    text: '開始辨識'
                  }
                }
              ]
            }
          });
        }

        // 轉換 Recognition Status 為問題格式
        const responses = convertRecognitionStatusToQuestions(recognitionStatus);
        
        sessionManager.startQuiz(userId, recognitionStatus.image, 'verification', responses);
        
        const imageMessage = {
          type: 'image',
          originalContentUrl: recognitionStatus.image.imageUrl,
          previewImageUrl: recognitionStatus.image.imageUrl
        };

        // 顯示預填資料並開始確認流程
        const confirmationText = createConfirmationTextWithoutProposal(responses);
        const confirmationMessage = {
          type: 'template',
          altText: '請確認預填資料',
          template: {
            type: 'buttons',
            text: `📋 以下是其他填答者填答的資料：\n\n${confirmationText}\n\n💡 幫我檢查一次，沒問題就按下正確囉！`,
            actions: [
              {
                type: 'message',
                label: '✅ 資料正確',
                text: 'verify_first_stage_correct'
              },
              {
                type: 'message',
                label: '❌ 有錯誤',
                text: 'verify_first_stage_wrong'
              }
            ]
          }
        };
        
        return client.replyMessage(event.replyToken, [imageMessage, confirmationMessage]);
      } catch (error) {
        console.error('❌ 開始驗證模式時發生錯誤:', error);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '❌ 開始驗證模式時發生錯誤，請稍後再試。'
        });
      }
    }

    // 處理確認按鈕
    if (messageText === '第一階段確認') {
      // 第一階段確認（辨識模式）
      sessionManager.setFirstStageConfirmed(userId, true);
      
      const session = sessionManager.getSession(userId);
      const proposalReason = session.responses.proposal_reason || '';
      
      // 先發送完整的案由文字
      const proposalTextMessage = {
        type: 'text',
        text: `📝 案由：\n\n${proposalReason}`
      };
      
      // 再發送確認按鈕
      const confirmButtonMessage = {
        type: 'template',
        altText: '請確認案由是否正確',
        template: {
          type: 'buttons',
          text: '💡 再幫我瞄一眼案由，沒問題就按下正確囉！',
          actions: [
            {
              type: 'message',
              label: '✅ 案由正確',
              text: '第二階段確認'
            },
            {
              type: 'message',
              label: '✏️ 修改案由',
              text: 'modify_proposal_reason'
            }
          ]
        }
      };
      
      return client.replyMessage(event.replyToken, [proposalTextMessage, confirmButtonMessage]);
    }

    if (messageText === 'modify_first_stage') {
      // 第一階段修改（辨識模式）
      const session = sessionManager.getSession(userId);
      const confirmationText = createConfirmationTextWithoutProposal(session.responses);
      
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `📝 請複製以下內容，修改後貼上回傳給我：\n\n${confirmationText}\n\n💡 修改完成後，請直接貼上回傳。`
      });
    }

    if (messageText === '第二階段確認') {
      // 第二階段確認（辨識模式）
      sessionManager.setSecondStageConfirmed(userId, true);
      
      const session = sessionManager.getSession(userId);
      if (session && session.isTutorial && session.mode === 'tutorial_recognition') {
        sessionManager.clearSession(userId);
        const completionMessages = createTutorialCompletionMessages(session.mode);
        return client.replyMessage(event.replyToken, completionMessages);
      }
      
      try {
        const saveResult = await keystoneAPI.saveUserResponse({
          ...session.responses,
          imageId: session.photo.id,
          lineuserid: userId,  // 傳遞 LINE 使用者 ID
          type: 'recognition'
        });
        
        console.log('✅ 辨識結果儲存成功！');
        console.log(`📋 建立的 Recognition Status ID: ${saveResult.data?.id || '未知'}`);
        
        const completionMessage = `🎉 辨識完成！\n\n📊 辨識結果已儲存，感謝您的協助！\n\n👓 以下是有問題的時候要給管理者確認的訊息，一般狀況無須理會：\nRecognition Status ID: ${saveResult.data?.id || '未知'}\nImage ID: ${session.photo.id}`;
        
        sessionManager.clearSession(userId);
        
        // 發送完成訊息和主選單輪播
        const completionMessages = [
          {
            type: 'text',
            text: completionMessage
          },
          createMainMenuCarousel()
        ];
        
        return client.replyMessage(event.replyToken, completionMessages);
      } catch (error) {
        console.error('❌ 儲存辨識結果時發生錯誤:', error);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '❌ 儲存辨識結果時發生錯誤，請稍後再試。'
        });
      }
    }

    if (messageText === 'modify_proposal_reason') {
      // 修改案由（辨識模式）
      const session = sessionManager.getSession(userId);
      const proposalReason = session.responses.proposal_reason || '';
      
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `📝 案由：\n\n${proposalReason}\n\n請複製以上內容，修改後貼上回傳給我。`
      });
    }

    // 驗證模式確認按鈕
    if (messageText === 'verify_first_stage_correct') {
      // 驗證模式第一階段確認
      const session = sessionManager.getSession(userId);
      if (session && session.isTutorial && session.mode === 'tutorial_verification') {
        const tutorialLabel = tutorialHelper.getTutorialLabel(session.mode);
        const reminder = {
          type: 'text',
          text: '❌ 這份示範資料其實有些小錯誤（要不要再看看減列金額 👀？），一起再檢查一次就能過關！'
        };
        const summaryMessages = createTutorialVerificationSummaryMessages(session.responses || {}, tutorialLabel);
        return client.replyMessage(event.replyToken, [reminder, ...summaryMessages]);
      }
      sessionManager.setFirstStageConfirmed(userId, true);
      
      const proposalReason = session.responses.proposal_reason || '';
      
      // 先發送完整的案由文字
      const proposalTextMessage = {
        type: 'text',
        text: `📝 案由：\n\n${proposalReason}`
      };
      
      // 再發送確認按鈕
      const confirmButtonMessage = {
        type: 'template',
        altText: '請確認案由是否正確',
        template: {
          type: 'buttons',
          text: '💡 再幫我瞄一眼案由，沒問題就按下正確囉！',
          actions: [
            {
              type: 'message',
              label: '✅ 案由正確',
              text: 'verify_second_stage_correct'
            },
            {
              type: 'message',
              label: '❌ 案由錯誤',
              text: 'verify_second_stage_wrong'
            }
          ]
        }
      };
      
      return client.replyMessage(event.replyToken, [proposalTextMessage, confirmButtonMessage]);
    }

    if (messageText === 'verify_first_stage_wrong') {
      // 驗證模式第一階段修改
      const session = sessionManager.getSession(userId);
      if (session && session.isTutorial && session.mode === 'tutorial_verification') {
        sessionManager.updateSession(userId, {
          tutorialShowCorrection: true
        });
        const updatedSession = sessionManager.getSession(userId);
        return sendTutorialVerificationStage(
          userId,
          event.replyToken,
          updatedSession,
          updatedSession.tutorialStage || 0
        );
      }
      const confirmationText = createConfirmationTextWithoutProposal(session.responses);
      
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `📝 請複製以下內容，修改後貼上回傳給我：\n\n${confirmationText}\n\n💡 修改完成後，請直接貼上回傳。`
      });
    }

    if (messageText === 'verify_second_stage_correct') {
      // 驗證模式第二階段確認
      sessionManager.setSecondStageConfirmed(userId, true);
      
      const session = sessionManager.getSession(userId);
      
      try {
        if (session && session.isTutorial && session.mode === 'tutorial_verification') {
          sessionManager.clearSession(userId);
          const completionMessages = createTutorialCompletionMessages(session.mode);
          return client.replyMessage(event.replyToken, completionMessages);
        }
        const saveResult = await keystoneAPI.saveVerificationResult({
          ...session.responses,
          imageId: session.photo.id,
          lineuserid: userId,  // 傳遞 LINE 使用者 ID
          type: 'verification'
        });
        
        console.log('✅ 驗證結果儲存成功！');
        console.log(`📋 建立的 Recognition Status ID: ${saveResult.data?.id || '未知'}`);
        
        const completionMessage = `🎉 驗證完成！\n\n🙌 你的細心真的很重要，每一筆資料都讓大家更了解預算！要不要再挑戰一則？\n\n📊 驗證結果已儲存，感謝您的協助！\n\n👓 以下是有問題的時候要給管理者確認的訊息，一般狀況無須理會：\nRecognition Status ID: ${saveResult.data?.id || '未知'}\nImage ID: ${session.photo.id}`;
        
        sessionManager.clearSession(userId);
        
        // 發送完成訊息和主選單輪播
        const completionMessages = [
          {
            type: 'text',
            text: completionMessage
          },
          createMainMenuCarousel()
        ];
        
        return client.replyMessage(event.replyToken, completionMessages);
      } catch (error) {
        console.error('❌ 儲存驗證結果時發生錯誤:', error);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '❌ 小幫手忙不過來，稍等我一下再試試看，好嗎？'
        });
      }
    }

    if (messageText === 'verify_second_stage_wrong') {
      // 驗證模式第二階段修改
      const session = sessionManager.getSession(userId);
      if (session && session.isTutorial && session.mode === 'tutorial_verification') {
        const reminder = {
          type: 'text',
          text: '❌ 這份示範的案由其實是正確的，點選「✅ 案由正確」就能完成這一關囉！'
        };
        const reasonMessages = createTutorialVerificationReasonMessages(
          session.responses || {},
          tutorialHelper.getTutorialLabel(session.mode)
        );
        return client.replyMessage(event.replyToken, [reminder, ...reasonMessages]);
      }
      const proposalReason = session.responses.proposal_reason || '';
      
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `📝 案由：\n\n${proposalReason}\n\n請複製以上內容，修改後貼上回傳給我。`
      });
    }

    // 檢查是否為辨識模式或驗證模式的修改回應
    const session = sessionManager.getSession(userId);

    if (feedbackSessions.has(userId) && messageText !== '回報問題') {
      if (FEEDBACK_EXIT_COMMANDS.has(messageText)) {
        exitFeedbackSession(userId);
      } else {
        const handled = await handleFeedbackSession(userId, event.replyToken, messageText);
        if (handled) {
          return;
        }
      }
    }

    if (messageText === '回報問題') {
      console.log('📮 使用者想要回報問題');
      feedbackSessions.set(userId, { stage: FEEDBACK_STATE.ISSUE });
      sessionManager.clearSession(userId);
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: FEEDBACK_PROMPT_TEXT
      });
      return;
    }

    if (session && session.isTutorial) {
      if (messageText === '跳出') {
        console.log('🎓 使用者輸入跳出，離開教學模式');
        const exitMessage = createTutorialExitMessage(tutorialHelper.getTutorialLabel(session.mode));
        sessionManager.clearSession(userId);
        return client.replyMessage(event.replyToken, exitMessage);
      }
      console.log('🎓 教學模式回答流程中');
      return handleTutorialResponse(event, session, messageText);
    }
    
    if (session && session.mode === 'recognition' && !session.firstStageConfirmed) {
      // 辨識模式第一階段修改回應
      console.log('🔍 處理辨識模式第一階段修改回應');
      
      // 解析使用者回傳的修改內容
      const modifiedData = parseModifiedResponses(messageText);
      if (modifiedData && Object.keys(modifiedData).length > 0) {
        console.log('🔍 解析結果:', modifiedData);
        console.log('✅ 識別為修改回應，開始處理...');
        
        // 更新 session 中的回應
        Object.keys(modifiedData).forEach(key => {
          if (modifiedData[key] !== null && modifiedData[key] !== undefined) {
            session.responses[key] = modifiedData[key];
          }
        });
        
        // 標記第一階段已確認
        sessionManager.setFirstStageConfirmed(userId, true);
        
        // 進入第二階段：案由確認
        const proposalReason = session.responses.proposal_reason || '';
        
        const proposalTextMessage = {
          type: 'text',
          text: `📝 案由：\n\n${proposalReason}`
        };
        
        const confirmButtonMessage = {
          type: 'template',
          altText: '請確認案由是否正確',
          template: {
            type: 'buttons',
            text: '💡 再幫我瞄一眼案由，沒問題就按下正確囉！',
            actions: [
              {
                type: 'message',
                label: '✅ 案由正確',
                text: '第二階段確認'
              },
              {
                type: 'message',
                label: '✏️ 需要修改',
                text: 'modify_proposal_reason'
              }
            ]
          }
        };
        
        return client.replyMessage(event.replyToken, [proposalTextMessage, confirmButtonMessage]);
      }
    }
    
    if (session && session.mode === 'verification' && !session.firstStageConfirmed) {
      // 驗證模式第一階段修改回應
      console.log('🔍 處理驗證模式第一階段修改回應');
      
      // 解析使用者回傳的修改內容
      const modifiedData = parseModifiedResponses(messageText);
      if (modifiedData && Object.keys(modifiedData).length > 0) {
        console.log('🔍 解析結果:', modifiedData);
        console.log('✅ 識別為修改回應，開始處理...');
        
        // 更新 session 中的回應
        Object.keys(modifiedData).forEach(key => {
          if (modifiedData[key] !== null && modifiedData[key] !== undefined) {
            session.responses[key] = modifiedData[key];
          }
        });
        
        // 標記第一階段已確認
        sessionManager.setFirstStageConfirmed(userId, true);
        
        // 進入第二階段：案由確認
        const proposalReason = session.responses.proposal_reason || '';
        
        const proposalTextMessage = {
          type: 'text',
          text: `📝 案由：\n\n${proposalReason}`
        };
        
        const confirmButtonMessage = {
          type: 'template',
          altText: '請確認案由是否正確',
          template: {
            type: 'buttons',
            text: '💡 再幫我瞄一眼案由，沒問題就按下正確囉！',
            actions: [
              {
                type: 'message',
                label: '✅ 案由正確',
                text: 'verify_second_stage_correct'
              },
              {
                type: 'message',
                label: '❌ 案由錯誤',
                text: 'verify_second_stage_wrong'
              }
            ]
          }
        };
        
        return client.replyMessage(event.replyToken, [proposalTextMessage, confirmButtonMessage]);
      }
    }
    
    if (session && session.mode === 'verification' && session.firstStageConfirmed && !session.secondStageConfirmed) {
      // 驗證模式第二階段修改回應
      console.log('🔍 處理驗證模式第二階段修改回應');
      
      // 直接將使用者回傳的內容當作案由
      let finalProposalReason = messageText;
      
      // 如果使用者回傳的內容包含「案由：」前綴，則移除它
      if (finalProposalReason.startsWith('案由：') || finalProposalReason.startsWith('📝 案由：')) {
        finalProposalReason = finalProposalReason.replace(/^(📝 )?案由：\s*/, '');
      }
      
      // 正規化案由內容
      finalProposalReason = normalizeProposalReason(finalProposalReason);
      
      // 更新 session 中的案由
      session.responses.proposal_reason = finalProposalReason;
      
      // 標記第二階段已確認
      sessionManager.setSecondStageConfirmed(userId, true);
      
      try {
        const saveResult = await keystoneAPI.saveVerificationResult({
          ...session.responses,
          imageId: session.photo.id,
          lineuserid: userId,  // 傳遞 LINE 使用者 ID
          type: 'verification'
        });
        
        console.log('✅ 驗證結果儲存成功！');
        console.log(`📋 建立的 Recognition Status ID: ${saveResult.data?.id || '未知'}`);
        
        const completionMessage = `🎉 驗證完成！\n\n📊 驗證結果已儲存，感謝您的協助！\n\n👓 以下是有問題的時候要給管理者確認的訊息，一般狀況無須理會：\nRecognition Status ID: ${saveResult.data?.id || '未知'}\nImage ID: ${session.photo.id}`;
        
        sessionManager.clearSession(userId);
        
        // 發送完成訊息和主選單輪播
        const completionMessages = [
          {
            type: 'text',
            text: completionMessage
          },
          createMainMenuCarousel()
        ];
        
        return client.replyMessage(event.replyToken, completionMessages);
      } catch (error) {
        console.error('❌ 儲存驗證結果時發生錯誤:', error);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '❌ 儲存驗證結果時發生錯誤，請稍後再試。'
        });
      }
    }
    
    if (session && session.mode === 'recognition' && session.firstStageConfirmed && !session.secondStageConfirmed) {
      // 辨識模式第二階段修改回應
      console.log('🔍 處理辨識模式第二階段修改回應');
      
      // 直接將使用者回傳的內容當作案由
      let finalProposalReason = messageText;
      
      // 如果使用者回傳的內容包含「案由：」前綴，則移除它
      if (finalProposalReason.startsWith('案由：') || finalProposalReason.startsWith('📝 案由：')) {
        finalProposalReason = finalProposalReason.replace(/^(📝 )?案由：\s*/, '');
      }
      
      // 正規化案由內容
      finalProposalReason = normalizeProposalReason(finalProposalReason);
      
      // 更新 session 中的案由
      session.responses.proposal_reason = finalProposalReason;
      
      // 標記第二階段已確認
      sessionManager.setSecondStageConfirmed(userId, true);
      
      try {
        if (session.isTutorial && session.mode === 'tutorial_recognition') {
          sessionManager.clearSession(userId);
          const completionMessages = createTutorialCompletionMessages(session.mode);
          return client.replyMessage(event.replyToken, completionMessages);
        }
        const saveResult = await keystoneAPI.saveUserResponse({
          ...session.responses,
          imageId: session.photo.id,
          lineuserid: userId,  // 傳遞 LINE 使用者 ID
          type: 'recognition'
        });
        
        console.log('✅ 辨識結果儲存成功！');
        console.log(`📋 建立的 Recognition Status ID: ${saveResult.data?.id || '未知'}`);
        
        const completionMessage = `🎉 辨識完成！\n\n🙌 你的細心真的很重要，每一筆資料都讓大家更了解預算！要不要再挑戰一則？\n\n📊 辨識結果已儲存，感謝您的協助！\n\n👓 以下是有問題的時候要給管理者確認的訊息，一般狀況無須理會：\nRecognition Status ID: ${saveResult.data?.id || '未知'}\nImage ID: ${session.photo.id}`;
        
        sessionManager.clearSession(userId);
        
        // 發送完成訊息和主選單輪播
        const completionMessages = [
          {
            type: 'text',
            text: completionMessage
          },
          createMainMenuCarousel()
        ];
        
        return client.replyMessage(event.replyToken, completionMessages);
      } catch (error) {
        console.error('❌ 儲存辨識結果時發生錯誤:', error);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '❌ 小幫手忙不過來，稍等我一下再試試看，好嗎？'
        });
      }
    }

    // 處理問答流程
    if (session) {
      console.log(`🔍 進入主要問答流程處理邏輯`);
      const currentQuestion = QUESTIONS[session.currentQuestion];
      console.log(`🔍 當前問題: ${currentQuestion ? currentQuestion.id : 'null'}`);
      console.log(`🔍 當前問題索引: ${session.currentQuestion}`);
      
      if (currentQuestion) {
        // 處理特殊情況：如果用戶輸入的是「換一張」等選項
        if (currentQuestion.options && currentQuestion.options.some(opt => opt.value === messageText)) {
          if (messageText === 'skip_image') {
            // 處理「我想換其他提案單」邏輯
            console.log('🔄 用戶選擇換其他提案單，嘗試獲取新圖片');
            
            try {
              if (session.mode === 'recognition') {
                // 辨識模式：獲取新的隨機圖片
                const newPhoto = await keystoneAPI.getRandomPhoto(userId);
                if (!newPhoto) {
                  return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '📭 現在已經沒有需要辨識的圖片了！要不要再試試別的？',
                    quickReply: {
                      items: [
                        {
                          type: 'action',
                          action: {
                            type: 'message',
                            label: '✅ 驗證模式',
                            text: '開始驗證'
                          }
                        }
                      ]
                    }
                  });
                }
                
                // 更新會話中的圖片
                session.photo = newPhoto;
                sessionManager.sessions.set(userId, session);
                
                const imageMessage = {
                  type: 'image',
                  originalContentUrl: newPhoto.imageUrl,
                  previewImageUrl: newPhoto.imageUrl
                };
                
                const questionMessages = createQuestionMessages(currentQuestion);
                
                return client.replyMessage(event.replyToken, [imageMessage, ...questionMessages]);
                
              } else if (session.mode === 'verification') {
                // 驗證模式：獲取新的隨機 Recognition Status
                const newRecognitionStatus = await keystoneAPI.getRandomRecognitionStatus(userId);
                if (!newRecognitionStatus) {
                  return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '📭 現在已經沒有需要驗證的圖片了！要不要再試試別的？',
                    quickReply: {
                      items: [
                        {
                          type: 'action',
                          action: {
                            type: 'message',
                            label: '🔍 辨識模式',
                            text: '開始辨識'
                          }
                        }
                      ]
                    }
                  });
                }
                
                // 轉換 Recognition Status 為問題格式
                const responses = convertRecognitionStatusToQuestions(newRecognitionStatus);
                
                // 更新會話中的圖片和回應
                session.photo = newRecognitionStatus.image;
                session.responses = responses;
                sessionManager.sessions.set(userId, session);
                
                const imageMessage = {
                  type: 'image',
                  originalContentUrl: newRecognitionStatus.image.imageUrl,
                  previewImageUrl: newRecognitionStatus.image.imageUrl
                };
                
                // 顯示預填資料並開始確認流程
                const confirmationText = createConfirmationTextWithoutProposal(responses);
                const confirmationMessage = {
                  type: 'template',
                  altText: '請確認預填資料',
                  template: {
                    type: 'buttons',
                    text: `📋 以下是其他填答者填答的資料：\n\n${confirmationText}\n\n💡 幫我檢查一次，沒問題就按下正確囉！`,
                    actions: [
                      {
                        type: 'message',
                        label: '✅ 資料正確',
                        text: 'verify_first_stage_correct'
                      },
                      {
                        type: 'message',
                        label: '❌ 有錯誤',
                        text: 'verify_first_stage_wrong'
                      }
                    ]
                  }
                };
                
                return client.replyMessage(event.replyToken, [imageMessage, confirmationMessage]);
              }
            } catch (error) {
              console.error('❌ 換圖片時發生錯誤:', error);
              return client.replyMessage(event.replyToken, {
                type: 'text',
                text: '❌ 換圖片時發生錯誤，請稍後再試。'
              });
            }
          } else {
            // 其他選項（如「看不清楚」）
            sessionManager.saveAnswer(userId, currentQuestion.id, messageText);
          }
        } else {
          // 處理一般文字輸入
          let finalAnswer = messageText;
          
          // 處理特殊值轉換（現在直接使用中文值）
          if (currentQuestion.id === 'action_type') {
            // 直接使用使用者輸入的中文值
            finalAnswer = messageText;
          }
          
          // 處理驗證模式中的特殊值
          if (session.mode === 'verification') {
            const validation = validateVerificationInput(currentQuestion.id, messageText);
            if (!validation.isValid) {
              return client.replyMessage(event.replyToken, {
                type: 'template',
                altText: '輸入格式錯誤',
                template: {
                  type: 'buttons',
                  text: `❌ ${validation.message}\n\n不急，我們再輸入一次：`,
                  actions: [
                    {
                      type: 'message',
                      label: '重新輸入',
                      text: '重新輸入'
                    }
                  ]
                }
              });
            }
            
            // 驗證成功，使用處理後的值
            finalAnswer = validation.value;
          }
          
          // 處理數學公式計算（僅針對減列金額和凍結金額）
          if (currentQuestion.id === 'reduction_amount' || currentQuestion.id === 'freeze_amount') {
            const mathResult = safeMathEval(finalAnswer);
            if (mathResult !== null) {
              console.log(`🧮 數學計算: ${finalAnswer} = ${mathResult}`);
              finalAnswer = mathResult.toString();
            }
          }
          
          // 若為案由，先正規化內容
          if (currentQuestion.id === 'proposal_reason') {
            finalAnswer = normalizeProposalReason(finalAnswer);
          }
          // 儲存當前回答
          sessionManager.saveAnswer(userId, currentQuestion.id, finalAnswer);
        }

        // 獲取下一個問題（考慮條件）
        console.log(`🔍 獲取下一個問題...`);
        const nextQuestionData = sessionManager.getNextQuestion(userId);
        console.log(`🔍 下一個問題: ${nextQuestionData ? nextQuestionData.question.id : 'null'}`);
        
        // 檢查是否還有下一題
        if (!nextQuestionData) {
          // 所有問題都回答完了，開始兩階段確認流程
          if (session.mode === 'recognition') {
            // 辨識模式：顯示第一階段確認（除案由外的7個問題）
          const confirmationText = createConfirmationTextWithoutProposal(session.responses);
          
          const confirmationMessage = {
            type: 'template',
            altText: '請確認你的回答',
            template: {
              type: 'buttons',
          text: `${confirmationText}\n\n💡 再幫我快速檢查一次，沒問題就按下正確囉！`,
              actions: [
                {
                  type: 'message',
                  label: '✅ 以上正確',
                    text: '第一階段確認'
                },
                {
                  type: 'message',
                  label: '✏️ 需要修改',
                    text: 'modify_first_stage'
                }
              ]
            }
          };
          
          return client.replyMessage(event.replyToken, confirmationMessage);
        } else {
            // 驗證模式：直接顯示第一階段確認
            const confirmationText = createConfirmationTextWithoutProposal(session.responses);
            
            const confirmationMessage = {
              type: 'template',
              altText: '請確認你的回答',
              template: {
                type: 'buttons',
                text: `${confirmationText}\n\n💡 再幫我快速檢查一次，沒問題就按下正確囉！`,
                actions: [
                  {
                    type: 'message',
                    label: '✅ 以上正確',
                    text: 'verify_first_stage_correct'
                  },
                  {
                    type: 'message',
                    label: '❌ 有錯誤',
                    text: 'verify_first_stage_wrong'
                  }
                ]
              }
            };
            
            return client.replyMessage(event.replyToken, confirmationMessage);
          }
        } else {
          // 還有下一題，更新當前問題索引並顯示下一題
          sessionManager.setCurrentQuestion(userId, nextQuestionData.index);
          return client.replyMessage(event.replyToken, createQuestionMessages(nextQuestionData.question));
        }
      }
    }

    // 預設回應（未命中既有指令）：回傳主選單輪播
    return client.replyMessage(event.replyToken, createMainMenuCarousel());

  } catch (error) {
    console.error('Error handling event:', error.message);
    if (error && error.response && error.response.data) {
      console.error('LINE API error response data:', error.response.data);
    }
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '❌ 處理訊息時發生錯誤，請稍後再試。'
    });
  }
}

// Webhook 路由
app.post('/webhook', line.middleware(config), (req, res) => {
  console.log('📨 收到 webhook 請求');
  console.log('📊 請求內容:', JSON.stringify(req.body, null, 2));
  
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => {
      console.log('✅ 處理完成，回應:', result);
      res.json(result);
    })
    .catch((err) => {
      console.error('❌ Webhook 處理錯誤:', err.message);
      if (err && err.response && err.response.data) {
        console.error('❌ Webhook 錯誤回應內容:', err.response.data);
      }
      res.status(500).json({ error: err.message });
    });
});

// 添加 /callback 路由（LINE 有時會嘗試訪問這個端點）
app.post('/callback', line.middleware(config), (req, res) => {
  console.log('📨 收到 callback 請求，處理方式與 webhook 相同');
  // 使用相同的處理邏輯
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => {
      console.log('✅ 處理完成，回應:', result);
      res.json(result);
    })
    .catch((err) => {
      console.error('❌ Callback 處理錯誤:', err.message);
      if (err && err.response && err.response.data) {
        console.error('❌ Callback 錯誤回應內容:', err.response.data);
      }
      res.status(500).json({ error: err.message });
    });
});

// 健康檢查
app.get('/', (req, res) => {
  res.send('LINE Bot is running!');
});

// Rich Menu 管理路由已移除 - 由 LINE 後台管理

// 啟動伺服器
const port = process.env.PORT || 3000;

async function startServer() {
  try {
    console.log('🚀 正在啟動伺服器...');
    
    // 初始化 Keystone
    const keystoneInitialized = await keystoneAPI.initialize();
    if (keystoneInitialized) {
      console.log('✅ Keystone 初始化成功');
    } else {
      console.log('⚠️ Keystone 初始化失敗，但伺服器仍會啟動');
    }
    
    // 初始化 Rich Menu - 已停用，由 LINE 後台管理
    // try {
    //   await richMenuManager.initializeRichMenu();
    //   console.log('✅ Rich Menu 初始化成功');
    // } catch (error) {
    //   console.log('⚠️ Rich Menu 初始化失敗，但伺服器仍會啟動:', error.message);
    // }
    console.log('ℹ️ Rich Menu 由 LINE 後台管理，跳過自動初始化');
    
    app.listen(port, () => {
      console.log(`✅ Server is running on port ${port}`);
    });
  } catch (error) {
    console.error('❌ 啟動伺服器時發生錯誤:', error);
  }
}

startServer();