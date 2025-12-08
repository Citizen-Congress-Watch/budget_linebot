const axios = require('axios');

class KeystoneAPI {
  constructor() {
    this.baseURL = process.env.KEYSTONE_URL;
    
    // 檢查必要的環境變數
    if (!this.baseURL) {
      throw new Error('KEYSTONE_URL 環境變數未設定');
    }
    
    // 確保 URL 結尾沒有斜線，避免雙斜線問題
    const baseURL = this.baseURL.endsWith('/') ? this.baseURL.slice(0, -1) : this.baseURL;
    this.graphqlEndpoint = `${baseURL}/api/graphql`;
    this.isInitialized = false;
  }

  // 依照指定 ID 取得特定照片
  async getPhotoById(imageId) {
    try {
      if (!imageId && imageId !== 0) {
        console.error('❌ 未提供有效的 imageId');
        return null;
      }

      if (!this.isInitialized) {
        const initResult = await this.initialize();
        if (!initResult) {
          console.error('❌ 初始化失敗，無法取得指定照片');
          return null;
        }
      }

      const numericId = parseInt(imageId, 10);
      if (Number.isNaN(numericId)) {
        console.error('❌ imageId 必須是數字');
        return null;
      }

      const query = `
        query GetRecognitionImageById {
          recognitionImages(where: { id: { equals: ${numericId} } }) {
            id
            imageUrl
          }
        }
      `;

      const response = await axios.post(this.graphqlEndpoint, {
        query
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const image = response.data.data?.recognitionImages?.[0];
      if (!image) {
        console.warn(`⚠️ 找不到 ID 為 ${numericId} 的 Recognition Image`);
        return null;
      }

      return {
        id: image.id,
        imageUrl: image.imageUrl
      };
    } catch (error) {
      console.error('❌ 取得指定訊息圖片時發生錯誤:', error.message);
      if (error.response) {
        console.error('📊 錯誤回應:', error.response.data);
      }
      return null;
    }
  }

  // 初始化 Keystone 連接（應用啟動時調用）
  async initialize() {
    if (this.isInitialized) {
      console.log('✅ Keystone 已經初始化過了');
      return true;
    }

    console.log('🚀 正在初始化 Keystone 連接...');
    
    try {
      console.log('🔍 測試 GraphQL 連接...');
      const testQuery = `
        query TestQuery {
          recognitionImagesCount
        }
      `;
      
      const testResponse = await axios.post(this.graphqlEndpoint, {
        query: testQuery
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (testResponse.data.data?.recognitionImagesCount >= 0) {
        console.log('✅ GraphQL 連接測試成功！無需認證');
        this.isInitialized = true;
        this.authMethod = 'no_auth';
        return true;
      }
    } catch (error) {
      console.error('❌ GraphQL 連接測試失敗:', error.message);
      return false;
    }
    
    console.error('❌ Keystone 初始化失敗');
    return false;
  }


  // 取得隨機照片 (使用 GraphQL)
  async getRandomPhoto(excludeUserId = null) {
    try {
      console.log('🔍 嘗試連接 Keystone GraphQL...');
      console.log('URL:', this.graphqlEndpoint);
      
      // 如果已經初始化，直接使用
      if (this.isInitialized) {
        console.log('✅ 使用已初始化的連接');
      } else {
        // 重新初始化
        const initResult = await this.initialize();
        if (!initResult) {
          console.error('❌ 初始化失敗，無法獲取照片');
          return null;
        }
      }
      
      // 先查詢已經被辨識過兩次的圖檔 ID，以及被特定使用者辨識過的圖片
      let recognitionCountQuery = `
        query GetRecognitionCounts {
          recognitionStatuses(where: { type: { equals: "recognition" } }) {
            image {
              id
            }
            lineuserid
          }
        }
      `;
      
      console.log('🔍 查詢辨識次數');
      const recognitionResponse = await axios.post(this.graphqlEndpoint, {
        query: recognitionCountQuery
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      // 計算每個圖檔的辨識次數，並記錄被特定使用者辨識過的圖片
      const recognitionCounts = {};
      const userRecognizedImages = new Set(); // 記錄被特定使用者辨識過的圖片
      const recognitionStatuses = recognitionResponse.data.data?.recognitionStatuses || [];
      
      recognitionStatuses.forEach(status => {
        if (status.image && status.image.id) {
          recognitionCounts[status.image.id] = (recognitionCounts[status.image.id] || 0) + 1;
          
          // 如果指定了要排除的使用者，記錄該使用者已辨識的圖片
          if (excludeUserId && status.lineuserid === excludeUserId) {
            userRecognizedImages.add(status.image.id);
          }
        }
      });
      
      // 找出已經被辨識過兩次的圖檔 ID
      const fullyRecognizedImageIds = Object.keys(recognitionCounts).filter(imageId => recognitionCounts[imageId] >= 2);
      console.log('📊 已辨識次數統計:', recognitionCounts);
      console.log('🚫 已辨識兩次的圖檔 ID:', fullyRecognizedImageIds);
      
      if (excludeUserId) {
        console.log(`🚫 使用者 ${excludeUserId} 已辨識的圖片 ID:`, Array.from(userRecognizedImages));
      }
      
      // 構建排除條件
      let excludeCondition = '';
      const allExcludedIds = [...fullyRecognizedImageIds, ...userRecognizedImages];
      
      if (allExcludedIds.length > 0) {
        const excludeIds = allExcludedIds.map(id => `"${id}"`).join(', ');
        excludeCondition = `, id: { notIn: [${excludeIds}] }`;
      }
      
      // GraphQL 查詢（排除已辨識兩次的圖檔）
      const query = `
        query GetRecognitionImages {
          recognitionImages(where: { verificationStatus: { equals: "not_verified" }${excludeCondition} }) {
            id
            imageUrl
          }
        }
      `;
      
      console.log('🔍 查詢照片');
      const response = await axios.post(this.graphqlEndpoint, {
        query: query
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log('✅ GraphQL 回應狀態:', response.status);
      console.log('📊 回應資料:', JSON.stringify(response.data, null, 2));
      
      const photos = response.data.data?.recognitionImages;
      console.log('📸 照片數量:', photos ? photos.length : 0);
      
      if (photos && photos.length > 0) {
        const randomIndex = Math.floor(Math.random() * photos.length);
        const selectedPhoto = photos[randomIndex];
        console.log('🎲 選擇照片索引:', randomIndex);
        console.log('📷 選中的照片:', JSON.stringify(selectedPhoto, null, 2));
        
        // 返回標準化的照片物件
        return {
          id: selectedPhoto.id,
          imageUrl: selectedPhoto.imageUrl
        };
      }
      return null;
    } catch (error) {
      console.error('❌ Keystone GraphQL 錯誤:', error.message);
      if (error.response) {
        console.error('📝 錯誤詳情:', error.response.data);
        console.error('🔢 狀態碼:', error.response.status);
        
        // 如果是 GraphQL 錯誤，顯示具體錯誤
        if (error.response.data?.errors) {
          console.error('🚫 GraphQL 錯誤:', error.response.data.errors);
        }
        
        // 如果是 400 錯誤且是 GraphQL 驗證錯誤，可能是欄位名稱問題
        if (error.response.status === 400 && error.response.data?.errors) {
          const graphqlError = error.response.data.errors[0];
          if (graphqlError.message.includes('Cannot query field')) {
            console.error('🔧 可能是 GraphQL 欄位名稱錯誤，請檢查 schema');
          }
        }
      }
      return null;
    }
  }

  // 獲取隨機的 Recognition Status 記錄
  async getRandomRecognitionStatus(excludeUserId = null) {
    try {
      console.log('🔍 獲取隨機 Recognition Status...');
      
      // 如果已經初始化，直接使用
      if (this.isInitialized) {
        console.log('✅ 使用已初始化的連接');
      } else {
        // 重新初始化
        const initResult = await this.initialize();
        if (!initResult) {
          console.error('❌ 初始化失敗，無法獲取資料');
          return null;
        }
      }

      // 構建查詢條件
      let whereCondition = '{ image: { verificationStatus: { equals: "not_verified" } } }';
      
      if (excludeUserId) {
        whereCondition = `{ 
          AND: [
            { image: { verificationStatus: { equals: "not_verified" } } },
            { lineuserid: { not: { equals: "${excludeUserId}" } } }
          ]
        }`;
        console.log(`🚫 排除辨識者 userId: ${excludeUserId}`);
      }

      const query = `
        query GetRecognitionStatuses {
          recognitionStatuses(where: ${whereCondition}) {
            id
            type
            governmentBudgetResult
            budgetCategoryResult
            budgetAmountResult
            budgetTypeResult
            reductionAmountResult
            freezeAmountResult
            proposers
            coSigners
            reason
            image {
              id
              imageUrl
            }
          }
        }
      `;

      console.log('🔍 查詢 Recognition Status');
      const response = await axios.post(this.graphqlEndpoint, {
        query: query
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ GraphQL 回應狀態:', response.status);
      console.log('📊 回應資料:', JSON.stringify(response.data, null, 2));

      if (response.data.data?.recognitionStatuses?.length > 0) {
        const recognitionStatuses = response.data.data.recognitionStatuses;
        console.log('📋 Recognition Status 數量:', recognitionStatuses.length);
        
        // 過濾掉空的記錄（所有主要欄位都是 null 的記錄）
        const validStatuses = recognitionStatuses.filter(status => 
          status.governmentBudgetResult || 
          status.budgetCategoryResult || 
          status.budgetAmountResult || 
          status.budgetTypeResult || 
          status.reason
        );
        
        console.log('📋 有效 Recognition Status 數量:', validStatuses.length);
        
        if (validStatuses.length === 0) {
          console.log('📋 沒有找到有效的 Recognition Status');
          return null;
        }
        
        // 隨機選擇一個有效的記錄
        const randomIndex = Math.floor(Math.random() * validStatuses.length);
        const selectedStatus = validStatuses[randomIndex];
        console.log('🎲 選擇 Recognition Status 索引:', randomIndex);
        console.log('📷 選中的 Recognition Status:', JSON.stringify(selectedStatus, null, 2));
        
        return {
          id: selectedStatus.id,
          type: selectedStatus.type,
          governmentBudgetResult: selectedStatus.governmentBudgetResult,
          budgetCategoryResult: selectedStatus.budgetCategoryResult,
          budgetAmountResult: selectedStatus.budgetAmountResult,
          budgetTypeResult: selectedStatus.budgetTypeResult,
          reductionAmountResult: selectedStatus.reductionAmountResult,
          freezeAmountResult: selectedStatus.freezeAmountResult,
          proposers: selectedStatus.proposers,
          coSigners: selectedStatus.coSigners,
          reason: selectedStatus.reason,
          image: {
            id: selectedStatus.image.id,
            imageUrl: selectedStatus.image.imageUrl
          }
        };
      } else {
        console.log('📋 沒有找到可驗證的 Recognition Status');
        return null;
      }
    } catch (error) {
      console.error('❌ 獲取 Recognition Status 時發生錯誤:', error.message);
      if (error.response) {
        console.error('📊 錯誤回應:', error.response.data);
      }
      return null;
    }
  }

  // 儲存使用者回答
  async saveUserResponse(data) {
    try {
      console.log('💾 儲存使用者回答...');
      
      // 如果已經初始化，直接使用
      if (this.isInitialized) {
        console.log('✅ 使用已初始化的連接');
      } else {
        // 重新初始化
        const initResult = await this.initialize();
        if (!initResult) {
          console.error('❌ 初始化失敗，無法儲存資料');
          return { success: false, message: '無法連接到 Keystone' };
        }
      }

      const mutationData = {
        type: 'recognition',
        governmentBudgetResult: data.department || null,
        budgetCategoryResult: data.budget_subject || null,
        budgetAmountResult: data.budget_amount ? String(data.budget_amount) : null,
        budgetTypeResult: data.action_type || null,
        reductionAmountResult: data.reduction_amount ? String(data.reduction_amount) : null,
        freezeAmountResult: data.freeze_amount ? String(data.freeze_amount) : null,
        proposers: data.proposer || null,
        coSigners: data.co_signers || null,
        reason: data.proposal_reason || null,
        lineuserid: data.lineuserid || null,  // 新增 lineuserid 欄位
        image: data.imageId ? { connect: { id: parseInt(data.imageId) } } : null
      };

      const mutation = `
        mutation CreateRecognitionStatus($data: RecognitionStatusCreateInput!) {
          createRecognitionStatus(data: $data) {
            id
            type
            governmentBudgetResult
            budgetCategoryResult
            budgetAmountResult
            budgetTypeResult
            reductionAmountResult
            freezeAmountResult
            proposers
            coSigners
            reason
            image {
              id
              imageUrl
            }
          }
        }
      `;

      console.log('💾 儲存資料');
      const response = await axios.post(this.graphqlEndpoint, {
        query: mutation,
        variables: { data: mutationData }
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ 儲存成功！回應狀態:', response.status);
      console.log('📊 儲存結果:', JSON.stringify(response.data, null, 2));

      if (response.data.data?.createRecognitionStatus) {
        return {
          success: true,
          data: response.data.data.createRecognitionStatus,
          message: '回答已成功儲存'
        };
      } else {
        return {
          success: false,
          message: '儲存失敗：GraphQL 回應格式錯誤'
        };
      }
    } catch (error) {
      console.error('❌ 儲存時發生錯誤:', error.message);
      if (error.response) {
        console.error('📊 錯誤回應:', error.response.data);
        
        // 如果是 GraphQL 錯誤，顯示具體錯誤
        if (error.response.data?.errors) {
          console.error('🚫 GraphQL 錯誤:', error.response.data.errors);
        }
      }
      return {
        success: false,
        message: `儲存失敗：${error.message}`
      };
    }
  }

  // 儲存驗證結果
  async saveVerificationResult(data) {
    try {
      console.log('💾 儲存驗證結果...');
      
      // 如果已經初始化，直接使用
      if (this.isInitialized) {
        console.log('✅ 使用已初始化的連接');
      } else {
        // 重新初始化
        const initResult = await this.initialize();
        if (!initResult) {
          console.error('❌ 初始化失敗，無法儲存資料');
          return { success: false, message: '無法連接到 Keystone' };
        }
      }

      const verificationData = {
        type: 'verification',
        governmentBudgetResult: data.department || null,
        budgetCategoryResult: data.budget_subject || null,
        budgetAmountResult: data.budget_amount ? String(data.budget_amount) : null,
        budgetTypeResult: data.action_type || null,
        reductionAmountResult: data.reduction_amount ? String(data.reduction_amount) : null,
        freezeAmountResult: data.freeze_amount ? String(data.freeze_amount) : null,
        proposers: data.proposer || null,
        coSigners: data.co_signers || null,
        reason: data.proposal_reason || null,
        lineuserid: data.lineuserid || null,  // 新增 lineuserid 欄位
        image: data.imageId ? { connect: { id: parseInt(data.imageId) } } : null
      };

      const mutation = `
        mutation CreateRecognitionStatus($data: RecognitionStatusCreateInput!) {
          createRecognitionStatus(data: $data) {
            id
            type
            governmentBudgetResult
            budgetCategoryResult
            budgetAmountResult
            budgetTypeResult
            reductionAmountResult
            freezeAmountResult
            proposers
            coSigners
            reason
            image {
              id
              imageUrl
            }
          }
        }
      `;

      console.log('💾 儲存驗證結果');
      const response = await axios.post(this.graphqlEndpoint, {
        query: mutation,
        variables: { data: verificationData }
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ 驗證結果儲存成功！回應狀態:', response.status);
      console.log('📊 儲存結果:', JSON.stringify(response.data, null, 2));

      if (response.data.data?.createRecognitionStatus) {
        return {
          success: true,
          data: response.data.data.createRecognitionStatus,
          message: '驗證結果已成功儲存'
        };
      } else {
        return {
          success: false,
          message: '儲存失敗：GraphQL 回應格式錯誤'
        };
      }
    } catch (error) {
      console.error('❌ 儲存驗證結果時發生錯誤:', error.message);
      if (error.response) {
        console.error('📊 錯誤回應:', error.response.data);
        
        // 如果是 GraphQL 錯誤，顯示具體錯誤
        if (error.response.data?.errors) {
          console.error('🚫 GraphQL 錯誤:', error.response.data.errors);
        }
      }
      return {
        success: false,
        message: `儲存失敗：${error.message}`
      };
    }
  }

  async getRecognitionStatusById(statusId) {
    try {
      const numericId = parseInt(statusId, 10);
      if (Number.isNaN(numericId)) {
        console.error('❌ Recognition Status ID 必須是數字');
        return null;
      }

      if (!this.isInitialized) {
        const initResult = await this.initialize();
        if (!initResult) {
          console.error('❌ 初始化失敗，無法取得指定的 Recognition Status');
          return null;
        }
      }

      const query = `
        query GetRecognitionStatusById {
          recognitionStatuses(where: { id: { equals: ${numericId} } }) {
            id
            type
            governmentBudgetResult
            budgetCategoryResult
            budgetAmountResult
            budgetTypeResult
            reductionAmountResult
            freezeAmountResult
            proposers
            coSigners
            reason
            image {
              id
              imageUrl
            }
          }
        }
      `;

      const response = await axios.post(this.graphqlEndpoint, {
        query
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const status = response.data.data?.recognitionStatuses?.[0];
      if (!status) {
        console.warn(`⚠️ 找不到 ID 為 ${numericId} 的 Recognition Status`);
        return null;
      }

      return {
        id: status.id,
        type: status.type,
        governmentBudgetResult: status.governmentBudgetResult,
        budgetCategoryResult: status.budgetCategoryResult,
        budgetAmountResult: status.budgetAmountResult,
        budgetTypeResult: status.budgetTypeResult,
        reductionAmountResult: status.reductionAmountResult,
        freezeAmountResult: status.freezeAmountResult,
        proposers: status.proposers,
        coSigners: status.coSigners,
        reason: status.reason,
        image: status.image
      };
    } catch (error) {
      console.error('❌ 取得指定 Recognition Status 時發生錯誤:', error.message);
      if (error.response) {
        console.error('📊 錯誤回應:', error.response.data);
      }
      return null;
    }
  }
}

module.exports = KeystoneAPI;
