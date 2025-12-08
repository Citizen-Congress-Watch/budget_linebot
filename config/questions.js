const QUESTIONS = [
  {
    id: 'department',
    text: '這張圖片中是哪個部會的預算？\n\n💡 這個資訊會出現在提案單的「單位名稱」。請直接輸入部會名稱，例如：教育部、交通部、經濟部等',
    type: 'mixed_input',
    placeholder: '請輸入部會名稱',
    validation: 'text',
    options: [
      { label: '我想換其他提案單', value: 'skip_image' }
    ]
  },
  {
    id: 'budget_subject',
    text: '這張提案單上標示的預算科目為？\n\n💡 請查看「科目（計畫）名稱」及「用途別」欄位後面寫的字，不同提案單的格式會略有不同。如果兩個欄位都有寫，請用空格連結兩個內容，例如「中央研究院 設備及投資-機械設備費」',
    type: 'mixed_input',
    placeholder: '請輸入預算科目名稱',
    validation: 'text',
    options: [
      { label: '我想換其他提案單', value: 'skip_image' }
    ]
  },
  {
    id: 'budget_amount',
    text: '這張提案單上標示的預算金額為？\n\n💡 通常為「本年度預算數」後面的數字，請換算成阿拉伯數字後輸入',
    type: 'mixed_input',
    placeholder: '請輸入預算金額數字',
    validation: 'number',
    options: [
      { label: '看不清楚', value: 'unclear' },
      { label: '我想換其他提案單', value: 'skip_image' }
    ]
  },
  {
    id: 'action_type',
    text: '這是減列、凍結、減列＋凍結還是主決議？\n\n💡 請查看提案單上的「減列」跟「凍結」哪個後面有金額數字？如果都沒有，就是主決議（指建議性質的提案）。',
    type: 'quick_reply',
    options: [
      { label: '減列', value: '減列' },
      { label: '凍結', value: '凍結' },
      { label: '減列＋凍結', value: '減列＋凍結' },
      { label: '主決議', value: '主決議' },
      { label: '不確定', value: '不確定' },
      { label: '我想換其他提案單', value: 'skip_image' }
    ]
  },
  {
    id: 'reduction_amount',
    text: '這張提案單上標示的減列金額為？\n\n💡 請輸入完整的數字，例如：1500000、5000000\n🧮 支援數學公式計算，例如：10000*0.1、5000000/10',
    type: 'mixed_input',
    placeholder: '請輸入減列金額數字或數學公式',
    validation: 'text',
    condition: 'action_type === "減列" || action_type === "減列＋凍結"',
    options: [
      { label: '看不清楚', value: 'unclear' },
      { label: '我想換其他提案單', value: 'skip_image' }
    ]
  },
  {
    id: 'freeze_amount',
    text: '這張提案單上標示的凍結金額為？\n\n💡 請輸入完整的數字，例如：1500000、5000000、12000000\n🧮 支援數學公式計算，例如：10000*0.1、5000000/10',
    type: 'mixed_input',
    placeholder: '請輸入凍結金額數字或數學公式',
    validation: 'text',
    condition: 'action_type === "凍結" || action_type === "減列＋凍結"',
    options: [
      { label: '看不清楚', value: 'unclear' },
      { label: '我想換其他提案單', value: 'skip_image' }
    ]
  },
  {
    id: 'proposal_reason',
    text: '提案單的案由是什麼？\n\n💡 請下載機器人傳給你的圖片，並點選照片按鈕，選取該圖片後，點選「轉為文字」，將圖片中的「案由」文字複製出來，回傳給機器人。若辨識出來的文字有錯誤，或有手寫字跡，請修改後再送出。\n\n💡 為什麼要下載？目前 LINE 規定官方帳號無法使用 AI 功能辨識機器人傳送的圖片，但使用者自己的圖片不在此限。',
    type: 'mixed_input',
    placeholder: '請輸入案由內容',
    validation: 'text',
    options: [
      { label: '我想換其他提案單', value: 'skip_image' }
    ]
  },
  {
    id: 'proposer',
    text: '提案單上的提案人是誰？\n\n💡 請輸入提案人姓名，有多人的話用、分隔。如果沒有特別標示，通常第一個名字是提案人，剩下都是連署人。',
    type: 'mixed_input',
    placeholder: '請輸入提案人姓名',
    validation: 'text',
    options: [
      { label: '看不清楚', value: 'unclear' },
      { label: '我想換其他提案單', value: 'skip_image' }
    ]
  },
  {
    id: 'co_signers',
    text: '提案單上的連署人是誰？\n\n💡 請輸入連署人姓名，有多人的話用、分隔。\n\n如果沒有特別標示，通常第一個名字是提案人，剩下都是連署人。如果有其中一個人看不清楚，可以用「看不清楚」代稱。例如：王大明、看不清楚、陳小寶',
    type: 'mixed_input',
    placeholder: '請輸入連署人姓名',
    validation: 'text',
    options: [
      { label: '看不清楚', value: 'unclear' },
      { label: '我想換其他提案單', value: 'skip_image' }
    ]
  }
];

module.exports = { QUESTIONS };
