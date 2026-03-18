# AUTOPILOT_WORKFLOW.md - Jira → 開發 → 部署 全自動化流水線

**Role:** 你是 OpenClaw 自動化架構師，請根據以下流程規範，執行端到端的開發部署任務。

---

## 🚨 主 Session 行為規範（最高優先級）

### 主 Session 的角色：純調度員
- **主 Session 禁止直接執行任何步驟的實際工作**（禁止直接跑 curl、hg clone、grep 等）。
- 主 Session 的唯一職責：
  1. 接收 Shaun 的指令（Jira URL）
  2. 依序 `sessions_spawn` 各步驟的 Sub-agent
  3. 等待 Sub-agent 完成回報
  4. 更新 `workflow_state.json`
  5. 需要人工確認時（如 Step 2 專案名稱、Step 3 SDD 審核），暫停流水線並詢問 Shaun
  6. 在關鍵節點推送 Telegram 通知

### Sub-agent 執行規範
- **每個步驟都必須透過 `sessions_spawn` 開獨立 Session 執行**，對應 `(New Session)` 標記。
- 每個 Sub-agent 的 `task` 必須包含：
  - 明確的輸入檔案路徑
  - 明確的輸出檔案路徑
  - 成功/失敗判斷條件
- Sub-agent 完成後，主 Session 驗證輸出檔案存在，再進入下一步。

### 推薦主 Session 模型
- `vertex-claude-sonnet-4-6`（平衡成本與流程編排能力）
- 或 `vertex-claude-haiku-4-5`（最省成本，但複雜編排可能不穩定）

---

## Context

1. 參考 `TOOLS.md` 獲取 Jira 6.4.3、SCM (Mercurial) 1.46、Jenkins 2.516.3 的連線與 API 調用細節。
2. 採用 **"Spec-Driven"** 流程，確保程式實作與需求高度一致。
3. SCM 工具為 **Mercurial (hg)**，非 Git。所有版控指令一律使用 `hg` 系列命令。
4. 工作目錄標準路徑：`autopilot/{IssueID}/`（存放所有中間產出物）。
5. 分支命名規範：`branch-{IssueID}-autopilot`（例如：`branch-QOP-5878-autopilot`）。
6. 基礎分支：一律從 `testing` 分支起始（`hg update testing`），若無 `testing` 則暫停流水線並詢問 Shaun
7. Jira 資料抓取：使用 REST API (`curl -u username:password "http://jira.shaun.com/rest/api/2/issue/{IssueID}"`)，不使用 browser 工具。

---

## 步驟 0：環境檢查 (Pre-flight Check)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：** 在正式啟動流水線之前，驗證所有依賴環境的可用性。
* **檢查清單：**
  1. **SSH 連線**：確認可透過 SSH 連線至 server-200（`ssh -i /home/node/.ssh/id_rsa user@$hostname`）。
  2. **SCM 可達**：確認 `http://scm.shaun.com/scm` 可回應。
  3. **Jenkins 可達**：確認 `http://jenkins.shaun.com` 可回應。
  4. **Jira 可達**：確認 Jira REST API 可正常讀取目標 Issue。
  5. **磁碟空間**：server-200 磁碟使用率 < 85%。
* **失敗處理：** 任何一項檢查失敗，立即中止流水線並通知 Shaun，附上失敗原因。
* **輸出：** 更新 `workflow_state.json`，記錄 `preflight: passed/failed`。

---

## 步驟 1：需求解析 (The Gatherer)

* **輸入：** 用戶提供的 **Jira URL**。
* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：** 從 URL 中提取 Issue ID，調用 Jira REST API 獲取詳細 Description 與 Comments。
* **輸出：** 產出 `autopilot/{IssueID}/jira_requirement.md`（包含需求背景、驗收標準、關聯 Issue）。

---

## 步驟 2：代碼準備 (The Fetcher)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **前置條件：** ⚠️ **強制人工確認** — 主 Session 必須先向 Shaun 確認：
  1. SCM 上的專案名稱（例如 `tech-issue-pom`）
  2. 是否有特定分支需求（預設從 `testing` 起始）
  - **未經 Shaun 確認前，禁止執行 `hg clone`。**
* **任務：**
  1. 從 SCM 拉取專案源碼（`http://scm.shaun.com/scm/hg/{project-pom}`）。
  2. 執行 `hg update testing` 切換至 testing 分支。
  3. 驗證分支：執行 `hg branch` 確認輸出為 `testing`，否則視為失敗。
  4. 確認工作目錄乾淨（`hg status` 無未提交變更）。
* **輸出：** 本地工作空間的專案源碼（基於 testing 分支，已驗證）。

---

## 步驟 2.5：資料層快照 (The Schema Collector) 🆕

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：** 在 Architect 設計之前，同時從 **資料庫** 與 **JPA Entity/VO 源碼** 兩端提取資料層快照，建立「DB ↔ Java 映射對照表」，確保後續 SQL/JPQL 編寫基於真實欄位。
* **觸發條件：** 當需求涉及資料庫查詢或資料操作時（由主 Session 判斷），必須執行此步驟。
* **步驟：**

  ### A. DB Schema 端（資料庫真相）
  1. 根據需求分析（Step 1 產出），識別可能涉及的資料表名稱（從源碼 Entity 的 `@Table(name="...")` 註解中提取）。
  2. SSH 至 server-200，連接相關資料庫，對每個目標資料表執行：
     ```sql
     DESCRIBE {table_name};
     SHOW INDEX FROM {table_name};
     ```

  ### B. JPA Entity/VO 端（Java 映射契約）
  1. 在專案源碼中搜尋相關 Entity 類（`grep -r "@Table" --include="*.java"`）。
  2. 對每個相關 Entity，提取以下資訊：
     - 類名與 `@Table(name="...")` 對應的資料表名
     - 所有 `@Column(name="...")` 欄位映射（Java 屬性名 ↔ DB 欄位名）
     - `@JoinColumn`、`@ManyToOne`、`@OneToMany` 等關聯映射
     - 是否有 `@Transient`（非持久化欄位，不對應 DB）
  3. 如果使用 Native SQL（而非 JPQL），需特別標註：Native SQL 中必須用 **DB 欄位名**（`@Column.name`），而非 Java 屬性名。

  ### C. 交叉比對驗證
  1. 建立 **DB ↔ Java 映射對照表**，逐欄位比對：
     - DB 欄位名 ↔ `@Column(name="...")` 是否一致
     - DB 欄位型別 ↔ Java 型別是否相容
     - 標記任何 **不一致** 或 **DB 存在但 Entity 缺少** 或 **Entity 存在但 DB 缺少** 的情況
  2. 如發現不一致，在輸出中標註 ⚠️ 警告，供 Architect 設計時參考。

* **輸出：** `autopilot/{IssueID}/db_schema_snapshot.md`，包含三個區塊：
  1. **DB Schema**：所有相關資料表的完整欄位清單（欄位名、型別、NULL/NOT NULL、Key、Default）+ 索引資訊
  2. **JPA Entity 映射**：每個 Entity 的 `@Table`、`@Column`、關聯映射摘要
  3. **DB ↔ Java 映射對照表**：逐欄位對照，標註一致性驗證結果
  - 此檔案為 Step 3（Architect）與 Step 4（Developer）的 **必讀輸入**
* **失敗處理：** DB 連線失敗 → 中止流水線，通知 Shaun。

---

## 步驟 3：規格設計 (The Architect)

* **模型：** `vertex-claude-opus-4-6` (New Session)
* **任務：** 同時讀取 `autopilot/{IssueID}/jira_requirement.md`、`autopilot/{IssueID}/db_schema_snapshot.md`（若存在）與專案源碼，產出 `autopilot/{IssueID}/implementation_spec.json`。
* **核心規範：**
  - 必須列出修改檔案清單（完整路徑）。
  - 必須描述每個檔案的核心變更點。
  - 必須進行潛在影響分析（哪些模組可能受影響）。
  - 必須標註預期的驗收測試方式。
  - 🆕 **SQL/JPQL 欄位強制驗證** — 如果 spec 中包含任何查詢邏輯，Architect 必須在 spec 中附上 `sqlValidation` 區塊：
    - **Native SQL**：每個 `table.column` 必須在 `db_schema_snapshot.md` 的 **DB Schema 區塊** 中存在。
    - **JPQL/HQL**：每個 `entity.property` 必須在 `db_schema_snapshot.md` 的 **JPA Entity 映射區塊** 中存在。
    - 逐一列出並標註驗證結果（✅ 存在 / ❌ 不存在）。任何 ❌ 項目視為 spec 未通過，禁止進入 Step 4。
    - 特別注意：**Native SQL 中使用 DB 欄位名，JPQL 中使用 Java 屬性名**，兩者不可混用。
  - 🆕 **DB Migration 定義** — 如果需求涉及資料庫結構異動（新增/修改/刪除欄位、新增資料表、修改索引等），Architect **必須**在 `implementation_spec.json` 中附上 `dbMigration` 區塊：
    ```json
    {
      "dbMigration": {
        "database": "fusion|work|fusion_hr_sys|...",
        "port": 3306,
        "statements": [
          "ALTER TABLE tech_issue ADD COLUMN tag_stats TEXT DEFAULT NULL COMMENT '標籤統計快取'"
        ],
        "rollbackStatements": [
          "ALTER TABLE tech_issue DROP COLUMN tag_stats"
        ],
        "affectedTables": ["tech_issue"],
        "验证SQL": [
          "DESCRIBE tech_issue"
        ]
      }
    }
    ```
    - `statements`：正向 migration SQL（按執行順序排列）
    - `rollbackStatements`：對應的反向回滾 SQL（每條 statement 必須有對應的 rollback）
    - `affectedTables`：受影響的資料表清單
    - `验证SQL`：執行後的驗證語句（用於確認變更生效）
    - **ALTER ADD ↔ ALTER DROP**、**ALTER MODIFY ↔ ALTER MODIFY（原始定義）**、**CREATE TABLE ↔ DROP TABLE** — rollback 必須精確對應
    - Architect 必須從 `db_schema_snapshot.md` 取得原始欄位定義，確保 rollback 可還原至變更前狀態
  - 🆕 **Properties Migration 定義** — 如果需求涉及外掛 config 異動（`/home/fusion-ap/config/` 目錄下的 `.properties` 檔案），Architect **必須**在 `implementation_spec.json` 中附上 `propertiesMigration` 區塊：
    ```json
    {
      "propertiesMigration": {
        "files": [
          {
            "path": "/home/fusion-ap/config/{service}.properties",
            "containerPath": "/srv/fusion/config/{service}.properties",
            "changes": [
              {
                "action": "add|modify|delete",
                "key": "some.config.key",
                "oldValue": null,
                "newValue": "new-value",
                "comment": "用途說明"
              }
            ]
          }
        ]
      }
    }
    ```
    - `path`：Host 上的絕對路徑（`/home/fusion-ap/config/` 開頭）
    - `containerPath`：容器內對應路徑（`/srv/fusion/config/` 開頭）
    - `action`：`add`（新增 key）、`modify`（修改 value）、`delete`（刪除 key）
    - `oldValue`：`modify` 和 `delete` 時必填（供 rollback 使用），`add` 時為 `null`
    - 如果不確定 properties 檔案名稱或現有內容，必須在 Step 2.5 中一併提取
  - ⚠️ **強制人工確認** — 必須跟 Shaun 仔細溝通後才產生 SDD 文件。主 Session 收到 Architect 的草案後，發送給 Shaun 審核，獲得批准後才進入 Step 4。**當 spec 包含 `dbMigration` 或 `propertiesMigration` 時，Shaun 審核範圍需額外涵蓋 migration SQL 與 rollback SQL 的正確性。**

---

## 步驟 4：程式實作 (The Developer)

* **模型：**
  - `vertex-claude-haiku-4-5`：負責開立新分支 (New Session)。
    ```bash
    hg update testing
    hg branch branch-{IssueID}-autopilot
    ```
  - `vertex-claude-sonnet-4-6`：負責 Coding (New Session)。
* **嚴格約束：** 僅能修改 `implementation_spec.json` 指定範圍，嚴禁額外重構或調整，以確保 Context 精簡與邏輯專一。
* 🆕 **SQL/JPQL 欄位約束：** Developer 在編寫查詢時，**必須參照 `autopilot/{IssueID}/db_schema_snapshot.md`**：
  - **Native SQL** → 使用 DB Schema 區塊中的真實 DB 欄位名（`@Column(name="...")` 的值）
  - **JPQL/HQL** → 使用 JPA Entity 映射區塊中的 Java 屬性名
  - **禁止「猜測」欄位名稱**。如果所需欄位在 schema 快照中不存在，必須立即中止並回報主 Session。
  - 可參照「DB ↔ Java 映射對照表」確認 DB 欄位名與 Java 屬性名的對應關係。
* **輸出：** 修改完成的原始碼（僅限 spec 指定的檔案）。

---

## 步驟 5：代碼同步 (The Committer)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：**
  1. `hg add`（新增檔案時）
  2. `hg commit -m "[{IssueID}] {需求摘要}"`
  3. `hg push http://ai-werp-dev-bot:ai-werp-dev-bot@scm.iwerp.xyz:8000/scm/hg/{project-pom}`
* **Commit Message 規範：** `[{IssueID}] {一句話需求摘要}`
* **輸出：** SCM 上可見的新 changeset。

---

## 步驟 6：品質審計 (The Inspector - CR)

* **模型：** `vertex-claude-opus-4-6` (New Session)
* **CR 四大重點：**
  1. **安全性：** 檢查 SQL Injection、XSS、敏感資訊洩漏等漏洞。
  2. **效能：** 檢查 N+1 Query、死循環、不必要的內存占用。
  3. **規格偏離：** 比對實作是否完全符合 `implementation_spec.json`。
  4. 🆕 **SQL/JPQL Schema 雙重驗證：** 將程式碼中所有查詢語句，與 `autopilot/{IssueID}/db_schema_snapshot.md` 交叉比對：
     - **Native SQL** → 比對 DB Schema 區塊（DB 欄位名）
     - **JPQL/HQL** → 比對 JPA Entity 映射區塊（Java 屬性名）
     - 確認是否混用了 DB 欄位名與 Java 屬性名（常見錯誤）
     - **任何不存在的欄位名稱、或 Native SQL 中誤用 Java 屬性名，即為 CR 失敗（Critical）**，必須產出 `fix_list.md` 導回 Step 4。
* **流程：**
  - CR 通過 → 進入步驟 7。
  - CR 失敗 → 產出 `autopilot/{IssueID}/fix_list.md`，導回步驟 4 修正。
* **迭代上限：** 最多 **3 次**。超過 3 次 CR 仍未通過，立即中止流水線並通知 Shaun 人工介入，附上所有 `fix_list.md` 記錄。

---

## 步驟 6.5：環境變更預備 (The Migrator) 🆕

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **觸發條件：** `implementation_spec.json` 中存在 `dbMigration` 或 `propertiesMigration` 區塊時執行。若兩者皆不存在，跳過此步驟直接進入 Step 7。
* **任務：** 在 Jenkins 部署（Step 7）之前，先至 server-200 完成 DB Schema 異動與 Properties 變更，並產出完整的 rollback 資料包。
* **步驟：**

  ### A. 備份（不可跳過）

  #### A1. DB Schema 備份（當 `dbMigration` 存在時）
  1. SSH 至 server-200，對 `dbMigration.affectedTables` 中每張表執行：
     ```bash
     ssh -i /home/node/.ssh/id_rsa user@hostname
     # 匯出變更前的表結構（不含資料）
     mysqldump -u {user} -p'{password}' -P {port} --no-data {database} {table1} {table2} ... \
       > /tmp/pre_migration_schema_{IssueID}.sql
     # 逐表記錄現有欄位定義
     mysql -u {user} -p'{password}' -P {port} {database} -e "DESCRIBE {table_name};" \
       > /tmp/pre_migration_describe_{table_name}.txt
     ```
  2. 將備份檔案 SCP 回本地：`autopilot/{IssueID}/backup/pre_migration_schema.sql`

  #### A2. Properties 備份（當 `propertiesMigration` 存在時）
  1. SSH 至 server-200，對每個涉及的 properties 檔案建立備份：
     ```bash
     # 備份目錄
     mkdir -p /home/fusion-ap/config/backup-{IssueID}-$(date +%Y%m%d_%H%M%S)
     # 逐檔備份
     cp /home/fusion-ap/config/{service}.properties \
        /home/fusion-ap/config/backup-{IssueID}-$(date +%Y%m%d_%H%M%S)/
     ```
  2. 將備份檔案 SCP 回本地：`autopilot/{IssueID}/backup/config/`

  ### B. 執行 DB Migration（當 `dbMigration` 存在時）
  1. 將 `dbMigration.statements` 寫入 `autopilot/{IssueID}/migration.sql`。
  2. 將 `migration.sql` SCP 至 server-200 `/tmp/migration_{IssueID}.sql`。
  3. 執行 migration：
     ```bash
     mysql -u {user} -p'{password}' -P {port} {database} < /tmp/migration_{IssueID}.sql
     ```
  4. 執行驗證 SQL（`dbMigration.验证SQL`），確認變更生效：
     ```bash
     mysql -u {user} -p'{password}' -P {port} {database} -e "DESCRIBE {table_name};"
     ```
     - 比對輸出：新增的欄位/索引必須出現在 DESCRIBE 結果中。
     - 若驗證失敗 → **立即執行 rollback SQL 還原**，中止流水線並通知 Shaun。

  ### C. 執行 Properties 變更（當 `propertiesMigration` 存在時）
  1. 將變更內容寫入 `autopilot/{IssueID}/migration_properties.md`（人類可讀的變更清單）。
  2. SSH 至 server-200，對每個 properties 檔案執行變更：
     - `add`：在檔案末尾新增 `key=value`
     - `modify`：使用 `sed` 替換 `key=oldValue` → `key=newValue`
     - `delete`：使用 `sed` 刪除對應行
  3. 驗證變更：`grep` 確認每個 key 的值正確。
  4. **⚠️ 不在此步驟重啟容器** — 容器重啟由 Step 7（Jenkins 部署）統一處理。Properties 變更將在容器重啟後生效。

  ### D. 產出 Rollback 資料包
  1. 將 `dbMigration.rollbackStatements` 寫入 `autopilot/{IssueID}/rollback.sql`。
  2. 產出 `autopilot/{IssueID}/rollback_properties.md`，記錄每個 properties 的還原指令：
     - `add` 的 rollback → 刪除該 key
     - `modify` 的 rollback → 還原為 `oldValue`
     - `delete` 的 rollback → 重新加入 `key=oldValue`
  3. 產出 `autopilot/{IssueID}/rollback_guide.md`，包含完整的人工還原 SOP：
     ```markdown
     # Rollback Guide - {IssueID}

     ## 1. DB Schema 還原
     ```bash
     scp rollback.sql user@hostname:/tmp/
     ssh user@hostname
     mysql -u {user} -p'{password}' -P {port} {database} < /tmp/rollback.sql
     # 驗證
     mysql -u {user} -p'{password}' -P {port} {database} -e "DESCRIBE {table_name};"
     ```

     ## 2. Properties 還原
     ```bash
     # 方式一：從備份還原
     cp /home/fusion-ap/config/backup-{IssueID}-{timestamp}/{service}.properties \
        /home/fusion-ap/config/{service}.properties

     # 方式二：手動還原（見 rollback_properties.md）
     ```

     ## 3. 程式碼回滾
     透過 Jenkins 重新部署 testing 分支

     ## 4. 容器重啟
     docker restart {service}
     ```

* **輸出：**
  - `autopilot/{IssueID}/migration.sql`（正向 migration SQL）
  - `autopilot/{IssueID}/migration_properties.md`（Properties 變更清單）
  - `autopilot/{IssueID}/rollback.sql`（反向 rollback SQL）
  - `autopilot/{IssueID}/rollback_properties.md`（Properties 還原清單）
  - `autopilot/{IssueID}/rollback_guide.md`（完整人工還原 SOP）
  - `autopilot/{IssueID}/backup/`（變更前備份檔案）
* **失敗處理：**
  - DB Migration 執行失敗 → 立即執行 `rollback.sql`，還原 properties 備份，中止流水線通知 Shaun。
  - SSH 連線失敗 → 中止流水線通知 Shaun。
  - Properties 檔案不存在 → 中止流水線通知 Shaun（可能路徑錯誤）。

---

## 步驟 7：自動部署 (The DevOps)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：**
  1. 調用 Jenkins API 觸發部署（參數：`Select=Self`, `RevisionType=BRANCH`, `Revision=branch-{IssueID}-autopilot`, `Env=hostname`）。
  2. 輪詢 Jenkins 建置狀態（間隔 15 秒，超時 10 分鐘）。
  3. 部署成功後，SSH 至 server-200 驗證：
     - WAR 檔案時間戳已更新。
     - Docker 容器正常運行（`docker ps`）。
     - 服務可回應 HTTP 請求（HTTP 200）。
  4. **前置確認**：若 `implementation_spec.json` 包含 `dbMigration` 或 `propertiesMigration`，確認 Step 6.5（The Migrator）已成功執行完畢。若 Step 6.5 未執行或失敗，**禁止啟動 Jenkins 部署**。
* **失敗處理：**
  - Jenkins 建置失敗 → 擷取 Console Output 關鍵錯誤，通知 Shaun。
  - 部署驗證失敗 → 通知 Shaun，建議回滾方式（重新部署 testing 分支）。

---

## 步驟 8：部署後驗證 (Smoke Test)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：** 針對部署結果執行基本可用性驗證。
* **驗證項目：**
  1. **HTTP 回應**：目標服務 URL 回傳 HTTP 200。
  2. **頁面可訪問**：關鍵頁面可正常載入（無 500/404 錯誤）。
  3. **容器穩定性**：部署後 60 秒內容器未重啟（`docker ps` 確認 Up time）。
  4. 🆕 **應用日誌深度檢查**：檢查容器日誌最後 200 行（`docker logs --tail=200`），搜尋以下關鍵字：
     - `Unknown column`（SQL 欄位錯誤）
     - `SQLGrammarException`（SQL 語法錯誤）
     - `PersistenceException`（JPA 持久化異常）
     - `could not extract ResultSet`（查詢結果集異常）
     - 與本次 Issue ID 相關的 ERROR 日誌
     - 任何匹配即視為 **Smoke Test 失敗**
  5. 🆕 **功能路徑觸發**（如適用）：如果 `implementation_spec.json` 中定義了 REST API 端點，嘗試用  觸發該端點（GET 或 POST），驗證不回傳 500 錯誤。
* **失敗處理：** Smoke Test 失敗 → 通知 Shaun，附上失敗項目與錯誤訊息，建議回滾。

---

## 步驟 8.5：環境清單建立 (The Scribe) 🆕

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：** 在 Confluence 上建立新的環境清單頁面，並與 Jira Issue 建立雙向連結。
* **前置條件：** Step 8（Smoke Test）通過後執行。
* **步驟：**

  ### A. 建立 Confluence 環境清單頁面
  1. 取得模板：透過 Confluence REST API 取得最新一版環境清單頁面（例如 `tech-issue version 8.32.0`）的 Storage Format HTML 作為模板。
  2. 確認父頁面：找到目標專案的環境清單父頁面（例如 `WERP 專案-環境確認清單 tech-issue`）。
  3. 建立新頁面：
     - 標題：`{scm-name} version {version}`（版本號由 Shaun 提供，未定時用 `NEXT`）
     - Space Key：`0BWER1`
     - 父頁面：專案對應的環境清單父頁面
     - 內容：複製模板結構，填入已知資訊（scm-name），其餘留空
  4. 使用 `POST /rest/api/content` 建立頁面。

  ### B. 填入環境異動資訊（當 Step 6.5 有執行時）🆕
  當 `implementation_spec.json` 包含 `dbMigration` 或 `propertiesMigration` 時，環境清單頁面必須額外填入以下欄位：

  1. **SQL 異動**：從 `autopilot/{IssueID}/migration.sql` 提取完整 SQL 內容，填入環境清單的對應欄位。格式範例：
     ```
     -- Database: {database} (Port: {port})
     ALTER TABLE tech_issue ADD COLUMN tag_stats TEXT DEFAULT NULL COMMENT '標籤統計快取';
     ```
  2. **Properties 異動**：從 `autopilot/{IssueID}/migration_properties.md` 提取變更清單，填入環境清單的對應欄位。格式範例：
     ```
     -- File: /home/fusion-ap/config/{service}.properties
     [ADD] some.config.key = new-value  (用途說明)
     [MOD] other.key: old-value → new-value
     [DEL] deprecated.key (原值: old-value)
     ```
  3. **Rollback SQL**：從 `autopilot/{IssueID}/rollback.sql` 提取完整回滾 SQL，填入環境清單的對應欄位。格式範例：
     ```
     -- Rollback for {IssueID}
     ALTER TABLE tech_issue DROP COLUMN tag_stats;
     ```
  - **目的**：確保上版正式站時，維運人員可直接從環境清單取得所有環境異動資訊與回滾指令，無需回頭翻閱開發產出物。

  ### C. 建立 Jira ↔ Confluence 雙向連結
  1. **Confluence → Jira**：更新環境清單頁面的 `jira` 欄位，填入 Jira Issue 連結（`http://jira.shaun.com/browse/{IssueID}`）。
  2. **Jira → Confluence**：在 Jira Issue 新增 Comment，附上 Confluence 環境清單頁面連結。

* **輸出：**
  - Confluence 頁面 URL（已建立並填入 Jira 連結）
  - Jira Comment ID（已附上 Confluence 連結）
  - 🆕 環境清單中的 SQL 異動、Properties 異動、Rollback SQL 欄位（當 Step 6.5 有執行時）
* **失敗處理：**
  - Confluence API 權限不足（403）→ 通知 Shaun 開放 `ai-werp-dev-bot` 在目標 Space 的 Create + Edit 權限。
  - 頁面建立失敗 → 記錄錯誤，不阻擋後續 Step 9（環境清單為輔助文件，非核心流程）。
* **注意事項：**
  - prod date、version、changeset 等欄位是否填入，由 Shaun 指示決定。
  - 上版正式站流程目前仍為手工處理，環境清單為追蹤用途。
  - 使用 Python 腳本處理 JSON/HTML 跳脫，避免 shell 跳脫問題。

---

## 步驟 9：驗收回報 (The Reporter)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：**
  1. 根據需求文件進行邏輯推理驗證（需求 vs 實作比對）。
  2. 在 Jira Issue **新增 Comment**，內容包含：
     - 部署完成時間
     - 修改範圍（檔案清單）
     - Smoke Test 結果
     - QA 驗證摘要
* **回報限制：** 僅新增 Comment，**不可更改 Issue 狀態**（狀態由人工決定）。

---

## ⚠️ 運作機制要求 (Operational Requirements)

### 1. State Persistence（狀態持久化）
- 每個步驟完成後，主 Session 必須將進度更新至 `.openclaw/workflow_state.json`。
- 記錄格式：
  ```json
  {
    "issueId": "QOP-XXXX",
    "currentStep": 3,
    "stepName": "The Architect",
    "status": "in_progress",
    "startedAt": "2026-03-10T06:30:00Z",
    "updatedAt": "2026-03-10T06:35:00Z",
    "crIterations": 0,
    "artifacts": {
      "jira_requirement": "autopilot/QOP-XXXX/jira_requirement.md",
      "implementation_spec": "autopilot/QOP-XXXX/implementation_spec.json",
      "migration_sql": "autopilot/QOP-XXXX/migration.sql",
      "migration_properties": "autopilot/QOP-XXXX/migration_properties.md",
      "rollback_sql": "autopilot/QOP-XXXX/rollback.sql",
      "rollback_properties": "autopilot/QOP-XXXX/rollback_properties.md",
      "rollback_guide": "autopilot/QOP-XXXX/rollback_guide.md",
      "backup_dir": "autopilot/QOP-XXXX/backup/"
    },
    "errors": []
  }
  ```

### 2. Context Pruning（上下文精簡）
- 每一輪 Sub-agent 啟動時 (New Session)，僅加載其任務相關的最少文件。
- 禁止將整個專案源碼作為 context 傳入，僅傳入 spec 指定的檔案。

### 3. Error Handling（錯誤處理）
- **重試策略：** 指數退避，最多 3 次（5 秒 → 15 秒 → 45 秒）。
- **適用範圍：** Jira API 逾時、SCM 連線失敗、Jenkins API 無回應等網路錯誤。
- **升級策略：** 3 次重試仍失敗 → 中止流水線，附上完整錯誤日誌。
- **不可重試：** 編譯錯誤、CR 失敗、邏輯錯誤等非暫態問題，直接進入對應的失敗處理流程。

### 4. 通知機制（Notification）
- **關鍵節點推送 Telegram 通知：**
  - 🚫 Pre-flight Check 失敗
  - ❌ CR 失敗（附修正建議）
  - ❌ 部署失敗（附 Console Output 摘要）
  - ❌ Smoke Test 失敗
  - ✅ 全流程完成（附部署摘要）
  - ⛔ 流水線中止（附原因與當前步驟）
- **非關鍵步驟（步驟 1-5 正常完成）不推送通知**，避免訊息轟炸。

### 5. 驗收失敗回退機制（Post-Deployment Fix）🆕

當 Step 9（Reporter）完成後，人工驗收發現功能異常時，依以下流程回退修正：

**回退路徑：**
```
驗收失敗
    ↓
(0) 判斷失敗類型：
    ├── A. 純程式碼邏輯問題（不涉及 DB/Properties 變更）→ 從 (2) 開始
    ├── B. 需要調整 DB Schema 或 Properties → 從 (1) 開始
    └── C. 需要完全回滾（功能方向錯誤）→ 走「人工回滾 SOP」（Section 6 Rollback 指引）
    ↓
(1) 判斷是否需要額外 migration
    ├── 需要新的 DB/Properties 變更 → 更新 spec 的 dbMigration/propertiesMigration → Step 6.5（The Migrator）
    └── 需要回滾已執行的 migration → 走人工回滾 SOP，再重新開始
    ↓
(2) 判斷是否有 db_schema_snapshot.md
    ├── 沒有 → 先補跑 Step 2.5（Schema Collector）
    └── 有 → 直接進入 Step 4
    ↓
(3) Step 4（Developer）— 根據錯誤日誌 + schema 快照修正程式碼
    ↓
(4) Step 5（Committer）— 重新 commit + push
    ↓
(5) Step 6（Inspector CR）— 重新審計（含 Schema 雙重驗證）
    ↓
(6) Step 6.5（Migrator）— 若 spec 有新增/修改 migration，重新執行（含備份）
    ↓
(7) Step 7（DevOps）— 重新部署
    ↓
(8) Step 8（Smoke Test）— 重新驗證（含日誌深度檢查）
    ↓
(9) Step 8.5（Scribe）— 更新 Confluence 環境清單（累加新的 SQL/Properties 異動）
    ↓
(10) Step 9（Reporter）— 更新 Jira Comment（記錄修復內容）
```

**注意事項：**
- **不可跳過 Step 5-6**：修正後的代碼必須重新推送 SCM 並通過 CR。
- **Step 4 修正時的輸入**：除了 `implementation_spec.json`，還需提供驗收失敗的錯誤日誌（異常堆棧）作為修正依據。
- **修復迭代上限**：與 CR 相同，最多 3 次。超過 3 次仍未通過驗收，中止流水線並通知 Shaun 人工介入。
- **Jira Comment 更新**：Step 9 應在原有 Comment 基礎上追加修復記錄，而非覆蓋。
- **Confluence 更新**：Step 8.5 在修復迭代中應**累加**新的 SQL/Properties 異動記錄，而非覆蓋。環境清單需完整反映所有變更歷程。
- **Migration 累加原則**：若修復涉及新的 DB 變更（例如第一次加了欄位，修復時又改了欄位型別），`migration.sql` 和 `rollback.sql` 必須累加更新，rollback 要能從最終狀態一路還原回最初狀態。

---

### 6. Rollback 指引（三層回滾 SOP）

回滾涉及三個層面：**DB Schema → Properties → 程式碼**。流水線負責**自動產出所有回滾資料**，但**回滾執行為人工決策**，不自動執行。

#### 回滾資料自動產出（Step 6.5 責任）
| 產出檔案 | 內容 | 用途 |
|----------|------|------|
| `rollback.sql` | 反向 DDL 語句 | 還原 DB Schema |
| `rollback_properties.md` | Properties 還原指令 | 還原 config 變更 |
| `rollback_guide.md` | 完整人工還原 SOP | 一站式操作手冊 |
| `backup/pre_migration_schema.sql` | 變更前 Schema 快照 | 最終防線：完整還原 |
| `backup/config/` | 變更前 Properties 備份 | 直接覆蓋還原 |

#### 人工回滾執行順序
當驗收後發現問題需要回滾時，依以下順序操作：

```
Step 1: DB Schema 還原（若有 dbMigration）
    ↓ 執行 rollback.sql
    ↓ 驗證：DESCRIBE 確認欄位已還原
    ↓
Step 2: Properties 還原（若有 propertiesMigration）
    ↓ 方式一：從 backup/ 直接覆蓋原檔
    ↓ 方式二：依 rollback_properties.md 手動還原
    ↓
Step 3: 程式碼回滾
    ↓ 透過 Jenkins 重新部署 testing 分支
    ↓ (RevisionType=BRANCH, Revision=testing)
    ↓
Step 4: 容器重啟與驗證
    ↓ docker restart {service}
    ↓ 確認 WAR 時間戳、容器正常、HTTP 200
```

**⚠️ 順序很重要**：必須**先還原 DB/Properties，再回滾程式碼**。若先回滾程式碼，舊版程式可能無法相容新的 DB Schema，導致啟動失敗。

#### Confluence 環境清單的角色
- Step 8.5 已將 `migration.sql`、`rollback.sql`、Properties 異動寫入 Confluence 環境清單。
- 上版正式站時，維運人員可直接從環境清單取得所有回滾指令，無需存取開發環境的 autopilot 目錄。

#### 注意事項
- **資料遺失風險**：若 migration 新增了欄位且已有業務資料寫入，DROP COLUMN 會導致資料遺失。此情況需 Shaun 判斷是否接受。
- **備份是最終防線**：`pre_migration_schema.sql` 保留了變更前的完整 Schema，可用 `mysqldump --no-data` 的輸出進行比對或極端情況下的還原。
- **Properties 備份有時間戳**：備份目錄名包含 Issue ID + 時間戳，可精確對應到哪次變更的備份。

---

**最後更新：** 2026-03-12
**維護者：** AI WERP Dev Bot 🦞
