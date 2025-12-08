class UserSessionManager {
  constructor() {
    this.sessions = new Map();
  }

  // 開始新的問答流程
  startQuiz(userId, photo, mode = 'recognition', preFilledResponses = {}, extraSessionData = {}) {
    this.sessions.set(userId, {
      photo: photo,
      mode: mode,  // 'recognition' 或 'verification'
      currentQuestion: 0,
      responses: preFilledResponses,  // 驗證模式時預填資料
      startTime: new Date(),
      confirmationState: false,
      firstStageConfirmed: false,  // 第一階段（7個問題）是否已確認
      secondStageConfirmed: false,  // 第二階段（案由）是否已確認
      ...extraSessionData
    });
  }

  // 取得使用者目前狀態
  getSession(userId) {
    return this.sessions.get(userId);
  }

  // 更新使用者狀態中的任意欄位
  updateSession(userId, updates = {}) {
    const session = this.sessions.get(userId);
    if (session) {
      Object.assign(session, updates);
      this.sessions.set(userId, session);
    }
  }

  // 儲存使用者回答並進入下一題
  saveAnswer(userId, questionId, answer) {
    const session = this.sessions.get(userId);
    if (session) {
      session.responses[questionId] = answer;
      session.currentQuestion++;
      this.sessions.set(userId, session);
    }
  }

  // 清除使用者狀態
  clearSession(userId) {
    this.sessions.delete(userId);
  }

  // 檢查是否完成所有問題
  isQuizComplete(userId) {
    const session = this.sessions.get(userId);
    return session && session.currentQuestion > require('../config/questions').QUESTIONS.length;
  }

  // 設定確認狀態
  setConfirmationState(userId, state) {
    const session = this.sessions.get(userId);
    if (session) {
      session.confirmationState = state;
      this.sessions.set(userId, session);
    }
  }

  // 設定第一階段確認狀態
  setFirstStageConfirmed(userId, state) {
    const session = this.sessions.get(userId);
    if (session) {
      session.firstStageConfirmed = state;
      this.sessions.set(userId, session);
    }
  }

  // 設定第二階段確認狀態
  setSecondStageConfirmed(userId, state) {
    const session = this.sessions.get(userId);
    if (session) {
      session.secondStageConfirmed = state;
      this.sessions.set(userId, session);
    }
  }

  // 檢查是否所有階段都已確認
  isAllStagesConfirmed(userId) {
    const session = this.sessions.get(userId);
    return session && session.firstStageConfirmed && session.secondStageConfirmed;
  }

  // 設定當前問題索引
  setCurrentQuestion(userId, questionIndex) {
    const session = this.sessions.get(userId);
    if (session) {
      session.currentQuestion = questionIndex;
      this.sessions.set(userId, session);
    }
  }

  // 獲取下一個問題（考慮條件）
  getNextQuestion(userId) {
    const session = this.sessions.get(userId);
    if (!session) return null;

    const { QUESTIONS } = require('../config/questions');
    
    // 從當前問題開始尋找符合條件的問題
    for (let i = session.currentQuestion; i < QUESTIONS.length; i++) {
      const question = QUESTIONS[i];
      
      // 如果問題沒有條件，直接返回
      if (!question.condition) {
        return { question, index: i };
      }
      
      // 檢查條件是否滿足
      if (this.evaluateCondition(question.condition, session.responses)) {
        return { question, index: i };
      }
    }
    
    return null; // 沒有更多問題
  }

  // 評估條件表達式
  evaluateCondition(condition, responses) {
    try {
      // 創建一個安全的評估環境
      const context = { ...responses };
      
      // 替換條件中的變數，但要避免替換字串中的變數
      let expression = condition;
      
      // 先找到所有變數名
      const variableNames = Object.keys(context);
      
      // 按長度排序，避免短變數名替換長變數名的部分
      variableNames.sort((a, b) => b.length - a.length);
      
      variableNames.forEach(key => {
        const value = context[key];
        // 如果是字串，需要加引號
        const stringValue = typeof value === 'string' ? `"${value}"` : value;
        // 使用更精確的替換，確保只替換完整的變數名
        const regex = new RegExp(`\\b${key}\\b`, 'g');
        expression = expression.replace(regex, stringValue);
      });
      
      // 安全評估表達式
      return eval(expression);
    } catch (error) {
      console.error('條件評估錯誤:', error);
      return false;
    }
  }

  // 檢查是否完成所有問題（考慮條件）
  isQuizComplete(userId) {
    const nextQuestion = this.getNextQuestion(userId);
    return nextQuestion === null;
  }
}

module.exports = UserSessionManager;
