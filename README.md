# 預算提案辨識 LINE Bot

一個基於 LINE 的預算提案圖片辨識與驗證 LINEBOT，協助使用者辨識和驗證政府預算提案單的內容。

## 功能特色

### 🔍 辨識模式
- **圖片辨識**：從 Keystone 資料庫隨機取得預算提案圖片
- **智慧問答**：透過結構化問答收集以下資訊：
  - 部會名稱
  - 預算科目
  - 預算金額
  - 提案類型（減列、凍結、減列＋凍結、主決議）
  - 減列金額（條件性問題）
  - 凍結金額（條件性問題）
  - 提案人
  - 連署人
  - 案由
- **數學計算**：支援金額欄位的數學公式計算
- **防重複機制**：避免使用者重複辨識同一張圖片

### ✅ 驗證模式
- **交叉驗證**：驗證其他使用者已辨識的提案內容
- **防自驗證**：避免使用者驗證自己辨識的結果
- **資料修正**：允許使用者修正錯誤的辨識結果

### 🛡️ 智慧防護機制
- **重複辨識防護**：不會顯示使用者已辨識過的圖片
- **自驗證防護**：不會顯示使用者自己辨識的結果供驗證
- **智慧導向**：當一個模式沒有可用內容時，自動引導到另一個模式
- **完整欄位顯示**：修改確認時顯示所有欄位，包括空值欄位

## 技術架構

### 核心技術
- **LINE Bot SDK**：處理 LINE 訊息事件和回覆
- **KeystoneJS**：作為後端 CMS，儲存圖片和辨識結果
- **Node.js + Express**：伺服器端架構
- **GraphQL**：與 KeystoneJS API 互動

### 專案結構
```
budget_linebot/
├── index.js                 # 主要程式入口
├── config/
│   └── questions.js         # 問答配置
├── utils/
│   ├── keystone.js         # Keystone API 封裝
│   └── userSession.js      # 使用者會話管理
├── package.json
└── README.md
```

## 安裝與設定

### 環境需求
- Node.js >= 16.0.0
- KeystoneJS 後端服務

### 安裝步驟

1. **複製專案**
```bash
git clone <repository-url>
cd budget_linebot
```

2. **安裝依賴**
```bash
npm install
```

3. **環境變數設定**
建立 `.env` 檔案並設定以下變數（請使用你自己的值，勿提交到版本庫）：
```env
# LINE Bot
LINE_CHANNEL_ACCESS_TOKEN=<your_line_channel_access_token>
LINE_CHANNEL_SECRET=<your_line_channel_secret>

# Keystone
KEYSTONE_URL=<your_keystone_graphql_base_url>

# 回報用 Google Sheets
FEEDBACK_SPREADSHEET_ID=<your_spreadsheet_id>
FEEDBACK_SHEET_RANGE=<sheet_name_and_range e.g. 回報!A:E>
GOOGLE_SERVICE_ACCOUNT_EMAIL=<service_account_email>
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=<service_account_private_key with \n>
```

4. **啟動服務**
```bash
npm start
```

### 開發模式
```bash
npm run dev
```

## 使用方式

### 開始使用
1. 在 LINE 中搜尋並加入 Bot，點選對應按鈕，或發送以下訊息開啟
2. 發送 `開始辨識` 開始辨識模式
3. 發送 `開始驗證` 開始驗證模式

### 辨識流程
1. Bot 會顯示一張預算提案圖片
2. 依序回答關於圖片內容的問題
3. 確認回答正確性
4. 系統儲存辨識結果

### 驗證流程
1. Bot 會顯示其他使用者已辨識的內容
2. 確認內容是否正確
3. 如有錯誤可進行修正
4. 系統儲存驗證結果

## 資料結構

### 辨識結果 (RecognitionStatus)
```javascript
{
  type: 'recognition',
  governmentBudgetResult: '部會名稱',
  budgetCategoryResult: '預算科目',
  budgetAmountResult: '預算金額',
  budgetTypeResult: '提案類型',
  reductionAmountResult: '減列金額',
  freezeAmountResult: '凍結金額',
  proposers: '提案人',
  coSigners: '連署人',
  reason: '案由',
  lineuserid: 'LINE使用者ID',
  image: { connect: { id: 圖片ID } }
}
```

### 驗證結果 (VerificationStatus)
```javascript
{
  type: 'verification',
  // ... 與辨識結果相同的欄位結構
}
```

## 部署

### Google Cloud Platform
專案包含 `app.yaml` 和 `Dockerfile`，支援部署到 Google Cloud Platform。

### Docker 部署
```bash
docker build -t budget-linebot .
docker run -p 3000:3000 --env-file .env budget-linebot
```

## 貢獻指南

1. Fork 專案
2. 建立功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交變更 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 開啟 Pull Request

## 授權

本專案採用 CC0 授權條款。

---

# Budget Proposal Recognition LINE Bot

A LINE-based budget proposal image recognition and verification LINEBOT that helps users recognize and verify government budget proposal document content.

## Features

### 🔍 Recognition Mode
- **Image Recognition**: Randomly retrieves budget proposal images from Keystone database
- **Smart Q&A**: Collects structured information through interactive questions:
  - Government department name
  - Budget category
  - Budget amount
  - Proposal type (reduction, freeze, reduction+freeze, main resolution)
  - Reduction amount (conditional question)
  - Freeze amount (conditional question)
  - Proposer
  - Co-signers
  - Proposal reason
- **Math Calculation**: Supports mathematical formula calculation for amount fields
- **Anti-Duplication**: Prevents users from recognizing the same image multiple times

### ✅ Verification Mode
- **Cross-Verification**: Verifies proposal content recognized by other users
- **Anti-Self-Verification**: Prevents users from verifying their own recognition results
- **Data Correction**: Allows users to correct erroneous recognition results

### 🛡️ Smart Protection Mechanisms
- **Duplicate Recognition Protection**: Won't show images already recognized by the user
- **Self-Verification Protection**: Won't show user's own recognition results for verification
- **Smart Guidance**: Automatically guides users to alternative modes when current mode has no available content
- **Complete Field Display**: Shows all fields including empty ones during modification confirmation

## Technical Architecture

### Core Technologies
- **LINE Bot SDK**: Handles LINE message events and replies
- **KeystoneJS**: Backend CMS for storing images and recognition results
- **Node.js + Express**: Server-side architecture
- **GraphQL**: Interacts with KeystoneJS API

### Project Structure
```
budget_linebot/
├── index.js                 # Main application entry
├── config/
│   └── questions.js         # Q&A configuration
├── utils/
│   ├── keystone.js         # Keystone API wrapper
│   └── userSession.js      # User session management
├── package.json
└── README.md
```

## Installation & Setup

### Requirements
- Node.js >= 16.0.0
- KeystoneJS backend service

### Installation Steps

1. **Clone Project**
```bash
git clone <repository-url>
cd budget_linebot
```

2. **Install Dependencies**
```bash
npm install
```

3. **Environment Variables**
Create `.env` file with the following variables (use your own values and do not commit secrets):
```env
# LINE Bot Configuration
LINE_CHANNEL_ACCESS_TOKEN=<your_line_channel_access_token>
LINE_CHANNEL_SECRET=<your_line_channel_secret>

# Keystone Configuration
KEYSTONE_URL=<your_keystone_graphql_base_url>

# Feedback (Google Sheets)
FEEDBACK_SPREADSHEET_ID=<your_spreadsheet_id>
FEEDBACK_SHEET_RANGE=<sheet_name_and_range e.g. 回報!A:E>
GOOGLE_SERVICE_ACCOUNT_EMAIL=<service_account_email>
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=<service_account_private_key with \n>
```

4. **Start Service**
```bash
npm start
```

### Development Mode
```bash
npm run dev
```

## Usage

### Getting Started
1. Search and add the Bot in LINE, click the corresponding button, or send the following messages to start
2. Send `開始辨識` to begin recognition mode
3. Send `開始驗證` to begin verification mode

### Recognition Flow
1. Bot displays a budget proposal image
2. Answer questions about the image content sequentially
3. Confirm answer accuracy
4. System saves recognition results

### Verification Flow
1. Bot displays content recognized by other users
2. Confirm if content is correct
3. Make corrections if errors are found
4. System saves verification results

## Data Structure

### Recognition Result (RecognitionStatus)
```javascript
{
  type: 'recognition',
  governmentBudgetResult: 'Department Name',
  budgetCategoryResult: 'Budget Category',
  budgetAmountResult: 'Budget Amount',
  budgetTypeResult: 'Proposal Type',
  reductionAmountResult: 'Reduction Amount',
  freezeAmountResult: 'Freeze Amount',
  proposers: 'Proposer',
  coSigners: 'Co-signers',
  reason: 'Proposal Reason',
  lineuserid: 'LINE User ID',
  image: { connect: { id: ImageID } }
}
```

### Verification Result (VerificationStatus)
```javascript
{
  type: 'verification',
  // ... Same field structure as recognition result
}
```

## Deployment

### Google Cloud Platform
The project includes `app.yaml` and `Dockerfile` for Google Cloud Platform deployment.

### Docker Deployment
```bash
docker build -t budget-linebot .
docker run -p 3000:3000 --env-file .env budget-linebot
```

## Contributing

1. Fork the project
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the CC0 License.
