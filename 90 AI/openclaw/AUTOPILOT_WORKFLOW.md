# AUTOPILOT_WORKFLOW.md - Jira → 開發 → 部署 全自動化流水線

**Role:** 你是 OpenClaw 自動化架構師，請根據以下流程規範，執行端到端的開發部署任務。

---

## 🚨 主 Session 行為規範（最高優先級）

### 主 Session 的角色：純調度員
- **主 Session 建議使用 `vertex-claude-sonnet-4-6` 關閉 think **（協調工作不需要 Opus，節省成本）。
- **主 Session 禁止直接執行任何步驟的實際工作**（禁止直接跑 curl、hg clone、grep 等）。
- 主 Session 的唯一職責：
  1. 接收 Shaun 的指令（Jira URL）
  2. 依序 `sessions_spawn` 各步驟的 Sub-agent（Step 0 ~ Step 17）
  3. 等待 Sub-agent 完成回報
  4. 更新 `autopilot/{IssueID}/workflow_state.json`
  5. 需要人工確認時（如 Step 1 需求品質關卡、Step 2 專案名稱、Step 7 SDD 審核），暫停流水線並詢問 Shaun
  6. 在關鍵節點推送 Telegram 通知

### Step 1 需求品質關卡處理
主 Session 收到 Step 1 產出的 `jira_requirement.md` 後，讀取末尾的「需求完整性評估」判定結果：
- 🟢 **PASS** → 直接進入 Step 2（仍須確認 SCM 專案名稱）
- 🟡 **CONDITIONAL** → 將缺項清單發送給 Shaun，等待回覆：
  - Shaun 口頭補充 → 主 Session 將補充內容追加至 `jira_requirement.md`，繼續 Step 2
  - Shaun 要求回 Jira 補寫 → 等待 Shaun 確認補寫完成後，重跑 Step 1
- 🔴 **BLOCK** → 通知 Shaun Jira 內容不足，列出所有缺項，請 Shaun 補充 Jira 後重跑 Step 1

### Sub-agent 執行規範
- **每個步驟都必須透過 `sessions_spawn` 開獨立 Session 執行**，對應 `(New Session)` 標記。
- ❌ **禁止將多個步驟合併到一個 Sub-agent**。例如：
  - ❌ Architect + Developer + CR 混在一個 Session
  - ❌ Framework Analyzer + Schema Collector 合併執行
  - ❌ Schema Collector + Architect 合併執行
  - ❌ Committer + CR 合併執行
  - ✅ 每個步驟獨立 Session，前一步完成才 spawn 下一步
- 每個 Sub-agent 的 `task` 必須包含：
  - 明確的輸入檔案路徑
  - 明確的輸出檔案路徑
  - 成功/失敗判斷條件
- Sub-agent 完成後，主 Session 驗證輸出檔案存在，再進入下一步。

---

## 🚫 流程紀律（絕對規範）

**何時可以簡化流程？永遠不可以。**

即使：
- ✓ 功能看起來「很簡單」
- ✓ 時間「很緊張」
- ✓ 「只是改一個小東西」

**都必須嚴格遵照本文件規範，因為：**
- 簡單功能也可能有隱藏的 DB Schema 依賴
- 流程規範存在是為了避免人為失誤和隱藏 Bug
- 每個步驟的模型選擇與分工是經過實戰驗證的，不可因成本或時間壓力而變更

**模型選擇是絕對規範**：各步驟指定的模型不可替換。詳見各步驟中的 ⚠️ 標註。
**成本優化策略**：透過腳本化（`scripts/autopilot/`）取代高成本模型的機械性工作，僅 Step 7（Architect）保留 Opus。

---

## Context

1. 參考 `TOOLS.md` 獲取 Jira 6.4.3、SCM (Mercurial) 1.46、Jenkins 2.516.3 的連線與 API 調用細節。
2. 採用 **"Spec-Driven"** 流程，確保程式實作與需求高度一致。
3. SCM 工具為 **Mercurial (hg)**，非 Git。所有版控指令一律使用 `hg` 系列命令。
4. 工作目錄標準路徑：`autopilot/{IssueID}/`（存放所有中間產出物與狀態檔案）。
5. 分支命名規範：`branch-{IssueID}-autopilot`（例如：`branch-QOP-5878-autopilot`）。所有涉及的 repo 使用相同分支名。
6. 基礎分支：一律從 `testing` 分支起始（`hg update testing`），若無 `testing` 則暫停流水線並詢問 Shaun。Lib 類型的 repo 基礎分支可能為 `default`（視 repo 而定）。
7. Jira 資料抓取：使用 REST API (`curl -u ******:****** "http://jira.shaun.lab:8080/rest/api/2/issue/{IssueID}"`)，不使用 browser 工具。
7a. **Jira 上傳（Comment / Attachment）：** 統一使用 `scripts/autopilot/jira_upload.sh` 腳本（詳見 `TOOLS.md` 的「Jira REST API 參考」），禁止手動拼 curl 命令。腳本內建 3 次重試 + 附件失敗自動 fallback 為 Comment 內嵌。
8. **多 Repo 架構支援**：一個 Jira Issue 可能涉及多個 SCM 專案的修改。流水線支援自動偵測跨專案影響，並按依賴順序建置/部署。
9. **專案分類**：

   | 分類 | 命名特徵 | Jenkins View | 建置方式 | 產物 |
   |------|---------|-------------|---------|------|
   | **`service`** | `-pom` 結尾 | `AI_WERP_DEV_BOT_DEPLOY` | Build + Deploy WAR | WAR → server-200 Docker 容器 |
   | **`lib`** | `-client`, `-vo`, `-taglib`, `-rest-client` 等 | `BUILD_LIB` | `mvn clean deploy` | JAR → Nexus Maven Repository |

   - `service` 類型由 DEPLOY Jenkins Job 部署至 Docker 容器
   - `lib` 類型由 BUILD_LIB Jenkins Job 編譯後上傳至 Nexus（`groupId: com.cy`），消費端 service 透過 Maven 依賴引用
   - 修改 lib 時，需新開版本號（A.B.C-SNAPSHOT），避免與正式站衝突

10. **多 Repo 產出物目錄結構**：
    ```
    autopilot/{IssueID}/
      jira_requirement.md                    # Step 0
      impact_matrix.json                     # Step 2B（Impact Discovery）
      workflow_state.json                    # 多 repo 追蹤結構
      repos/                                 # per-repo 產出物
        {project-name}/                      # 例如 tech-issue-pom/
          source/                            # hg clone 的源碼
          effective-pom.xml
          dep-tree.txt
          dependency_versions.md             # Step 3
          entity_graph.json                  # Step 5
          schema_raw.json                    # Step 5
          cr_auto_report.json                # Step 11
          cr_compliance_matrix.md            # Step 11
      db_schema_snapshot.md                  # Step 5（合併所有 repo）
      implementation_spec.json               # Step 7（統一 spec，含 repos[]）
      cr_result.md                           # Step 11（統一 CR 報告）
      migration.sql / rollback.sql           # Step 13
      test_report.md                         # Step 15
      ...
    ```

---

## Step 0：在正式啟動流水線之前進行需求解析 (The Gatherer)

* **輸入：** 用戶提供的 **Jira URL**。
* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：**
  1. 從 URL 中提取 Issue ID，調用 Jira REST API 獲取詳細 Description、附件與 Comments。
  2. 整理為結構化的需求文件（需求背景、驗收標準、關聯 Issue）。
  3. 對 Jira 內容進行 **需求完整性評估**（詳見下方 checklist）。
  4. **附件處理（強制）**：
     - 透過 Jira REST API 下載 Issue 的**所有附件**至 `autopilot/{IssueID}/attachments/` 目錄：
       ```bash
       # 取得附件清單
       curl -s -u ******:****** \
         "http://jira.shaun.lab:8080/rest/api/2/issue/{IssueID}" \
         | jq -r '.fields.attachment[] | "\(.filename) \(.content)"'
       
       # 逐一下載
       curl -s -u ******:****** \
         -o "autopilot/{IssueID}/attachments/{filename}" "{content_url}"
       ```
     - 在 `jira_requirement.md` 中新增「**附件清單**」章節，記錄：
       - 檔名、檔案大小、類型（圖片/Excel/PDF）
       - 在 Description 中被引用的位置（原文引述）
       - 標註為 **Visual Anchor 🎯**（若需求中有「格式需符合 xxx」「呈現方式需符合 xxx」等引用語句）
     - ⚠️ **Haiku 不做圖片內容分析**（vision 分析由 Step 7 Opus 執行）
* **需求完整性評估（6 維度 Checklist）：**

  | # | 維度 | 判斷問題 | ✅ 充足範例 | ❌ 不足範例 |
  |---|------|---------|-----------|-----------|
  | 1 | **What（做什麼）** | 能否用一句話描述需要實作的功能/修復/變更？ | 「新增標籤統計欄位」 | 「改一下那個功能」 |
  | 2 | **Where（在哪裡）** | 能否識別涉及的服務/模組/SCM 專案？ | 「tech-issue 模組的查詢頁面」 | 完全沒提到模組 |
  | 3 | **Why（為什麼）** | 有沒有業務背景或問題描述？ | 「使用者反映查詢太慢」 | 無任何上下文 |
  | 4 | **Acceptance（怎麼驗收）** | 有沒有可測試的驗收條件？ | 「查詢結果需包含統計數字」 | 無驗收標準 |
  | 5 | **Scope（範圍）** | 需求範圍是否明確可收斂？ | 單一功能點 | 「順便也把 XX 一起改」 |
  | 6 | **Technical（技術線索）** | 有沒有足夠的技術資訊供 Architect 設計？ | 提到表名/欄位/API/頁面 | 純業務語言零技術細節 |
  | 7 | **Cross-Service（跨服務）** | 是否涉及其他服務/共用 Lib 的修改？是否有跨服務 API 呼叫？ | 「需修改 common-client-vo」「portal 呼叫 tech-issue API」 | 描述中暗示跨服務但未明確列出涉及的服務端與消費端 |

* **判定邏輯：**

  | 結果 | 條件 | 流水線動作 |
  |------|------|-----------|
  | 🟢 **PASS** | 7/7 通過 | 主 Session 自動繼續 Step 2 |
  | 🟡 **CONDITIONAL** | 5-6 通過 | 主 Session 暫停，列出缺項詢問 Shaun（可口頭補充或回 Jira 補寫） |
  | 🔴 **BLOCK** | ≤4 通過 | 主 Session 強制暫停，請 Shaun 補充 Jira 內容後重跑 Step 1 |

* **輸出：** 產出 `autopilot/{IssueID}/jira_requirement.md`，包含：
  1. **需求內容**：需求背景、驗收標準、關聯 Issue
  2. **附件清單**（若有附件）：
     ```markdown
     ## 附件清單

     | 檔名 | 大小 | 類型 | Visual Anchor | 引用位置 |
     |------|------|------|---------------|----------|
     | screenshot-1.png | 330KB | 圖片 | 🎯 是 | 「此欄位的呈現方式需符合 screenshot-1.png」 |
     | sample.xlsx | 50KB | Excel | 否 | 無引用 |
     
     ⚠️ 標記為 Visual Anchor 的附件將在 Step 7（Architect, Opus）中進行視覺分析。
     ```
  3. **需求完整性評估**：附在文件末尾，格式如下：
     ```markdown
     ## 需求完整性評估

     | # | 維度 | 結果 | 依據 |
     |---|------|------|------|
     | 1 | What | ✅ | Description 明確描述「新增標籤統計功能」 |
     | 2 | Where | ✅ | 提及 tech-issue 模組 |
     | 3 | Why | ✅ | 業務需求：方便主管查看標籤分佈 |
     | 4 | Acceptance | ❌ | 無明確驗收標準 |
     | 5 | Scope | ✅ | 單一功能，無 scope creep |
     | 6 | Technical | 🟡 | 提及資料表但未指定欄位名 |

     **判定：🟡 CONDITIONAL**
     **缺項：** 驗收標準未定義、技術細節不完整
     **建議：** 請 Shaun 補充驗收條件，並確認是否需要新增 DB 欄位
     ```

---

## Step 1：環境檢查 (Pre-flight Check)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：** 驗證所有依賴環境的可用性。
* **檢查清單：**
  1. **SSH 連線**：確認可透過 SSH 連線至 server-200（`ssh -i /home/node/.ssh/id_ed25519 root@192.168.250.200`）。
  2. **SCM 可達**：確認 `http://scm.shaun.lab:8000/scm` 可回應。
  3. **Jenkins 可達**：確認 `http://jenkins-office.shaun.lab:8080` 可回應。
  4. **Jira 可達**：確認 Jira REST API 可正常讀取目標 Issue。
  5. **磁碟空間**：server-200 磁碟使用率 < 85%。
* **失敗處理：** 任何一項檢查失敗，立即中止流水線並通知 Shaun，附上失敗原因。
* **輸出：** 更新 `autopilot/{IssueID}/workflow_state.json`，記錄 `preflight: passed/failed`。

---

## Step 2：代碼準備與影響分析 (The Fetcher + Impact Discovery)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：** 拉取主專案源碼、分析跨 Repo 影響、經人工確認後拉取所有相關 Repo。
* **步驟分為四個階段：**

  ### Phase A：Clone Primary Repo

  * **前置條件：** ⚠️ **強制人工確認** — 主 Session 必須先向 Shaun 確認：
    1. SCM 上的**主要專案名稱**（例如 `tech-issue-pom`）
    2. 是否有特定分支需求（預設從 `testing` 起始）
    - **未經 Shaun 確認前，禁止執行 `hg clone`。**
  * **執行：**
    1. 從 SCM 拉取主專案源碼至 `autopilot/{IssueID}/repos/{project}/source/`。
    2. 執行 `hg update testing` 切換至 testing 分支。
    3. 驗證分支：執行 `hg branch` 確認輸出為 `testing`，否則視為失敗。
    4. 確認工作目錄乾淨（`hg status` 無未提交變更）。
    5. **提取框架版本原始資料**：執行 `mvn help:effective-pom -Doutput=effective-pom.xml` + `mvn org.apache.maven.plugins:maven-dependency-plugin:3.6.1:tree -DoutputFile=dep-tree.txt`。
    6. 將 `effective-pom.xml` 與 `dep-tree.txt` 複製至 `autopilot/{IssueID}/repos/{project}/`。

  ### Phase B：Impact Discovery（跨 Repo 影響分析）

  * **執行：** 執行 `scripts/autopilot/impact_analyzer.py`：
    ```bash
    python3 scripts/autopilot/impact_analyzer.py \
      --effective-pom autopilot/{IssueID}/repos/{project}/effective-pom.xml \
      --project-name {project} \
      --scm-base-url http://scm.shaun.lab:8000/scm \
      --scm-user ai-werp-dev-bot \
      --scm-pass ai-werp-dev-bot \
      --nexus-url https://nexus.shaun.lab \
      --jenkins-url http://jenkins-office.shaun.lab:8080 \
      --jenkins-user ai-werp-dev-bot \
      --jenkins-pass ai-werp-dev-bot \
      --output autopilot/{IssueID}/impact_matrix.json
    ```
  * **腳本自動完成：**
    1. 解析 `effective-pom.xml` 所有 `<dependency>` 條目
    2. 過濾 internal dependencies（`groupId = com.cy`）
    3. 對每個 internal dependency：
       - 推斷 SCM repo 名稱（artifactId 即 repo name）
       - 確認 SCM repo 存在
       - 查 Nexus 最新 release 版本與 SNAPSHOT 版本
       - 判斷分類（`lib` or `service`）：根據 BUILD_LIB job list vs DEPLOY job list
    4. **正向 Convention-based 發現**：如主專案為 `tech-issue-pom`，額外檢查 `tech-issue-client`、`tech-issue-vo` 等
    5. **⚠️ 反向 Service 關聯推薦（Cross-Service API 偵測）**：
       - 如果偵測到 `-client` 或 `-rest-client` 類型的 lib dependency，**自動反推對應的 service repo**
       - 規則：`{service}-client` → 推薦 `{service}-pom` 或 `{service}-rest-pom`
       - 範例：偵測到 `tech-issue-client` → 自動推薦 `tech-issue-pom`
       - 這代表主專案可能透過該 Client Lib 呼叫該 service 的 REST API
       - 推薦項標記 `"reason": "reverse-client-to-service"`，在 Phase C 呈報時醒目提示
  * **產出：** `autopilot/{IssueID}/impact_matrix.json`

  ### Phase C：⚠️ 人工確認（強制）

  * 主 Session 向 Shaun 呈報 Impact Discovery 結果：
    ```
    主專案：portal-pom (service)
    
    偵測到的 internal dependencies：
    ┌──────────────────────┬──────┬─────────────────────┬──────────────────┐
    │ 專案                  │ 分類  │ Nexus 最新版本       │ Jenkins Job       │
    ├──────────────────────┼──────┼─────────────────────┼──────────────────┤
    │ common-client-vo     │ lib  │ 2.1.0-SNAPSHOT       │ build-lib_...    │
    │ tech-issue-client    │ lib  │ 1.5.0               │ build-lib_...    │
    └──────────────────────┴──────┴─────────────────────┴──────────────────┘
    
    ⚠️ Cross-Service API 關聯推薦：
    ┌──────────────────────┬──────┬─────────────────────┬──────────────────┐
    │ 推薦專案              │ 分類  │ 推薦原因              │ Jenkins Job       │
    ├──────────────────────┼──────┼─────────────────────┼──────────────────┤
    │ tech-issue-pom       │ svc  │ ← tech-issue-client │ DEPLOY_...       │
    │                      │      │   的 API 提供端       │                  │
    └──────────────────────┴──────┴─────────────────────┴──────────────────┘
    → 如果本次需求涉及修改 tech-issue-client 的介面，
      tech-issue-pom 的 REST Controller 可能也需同步修改。
    
    請確認：
    1. 哪些專案需要一起修改？（含上方推薦的 API 提供端）
    2. 需要修改的 lib 專案，新版號為何？
       （版號規則：A.B.C，A=大改版 B=需求改版 C=問題修正，
        在最新版號對應位置 +1 後加 -SNAPSHOT）
    3. 跨服務 API 串接時，請確認 Deploy 順序：
       哪個 service 的 API 需要先上線？（API 提供端先於消費端）
    ```
  * **Shaun 回覆範例**：「需要改 tech-issue-client（版號 1.6.0-SNAPSHOT）+ tech-issue-pom + portal-pom，tech-issue-pom 先部署」
  * **單 Repo 場景**：Shaun 回覆「只有主專案」→ 後續流程自動退化為單 repo 行為，`repos[]` 長度 = 1
  * 主 Session 將確認結果更新至 `autopilot/{IssueID}/workflow_state.json`

  ### Phase D：Clone Remaining Repos

  * 對每個 Shaun 確認需要修改的額外 repo：
    1. `hg clone http://******:******@scm.shaun.lab:8000/scm/hg/{repo}` 至 `autopilot/{IssueID}/repos/{repo}/source/`
    2. `hg update testing`（若 repo 無 `testing` 分支，嘗試 `default`）
    3. 驗證分支 + 確認工作目錄乾淨
    4. 執行 `mvn help:effective-pom` + `mvn dependency:tree`
    5. 將 `effective-pom.xml` 與 `dep-tree.txt` 複製至 `autopilot/{IssueID}/repos/{repo}/`

* **輸出：**
  - 所有確認 repo 的源碼（基於 testing/default 分支，已驗證）
  - 每個 repo 的 `effective-pom.xml` 與 `dep-tree.txt`
  - `autopilot/{IssueID}/impact_matrix.json`（Impact Discovery 結果）
  - `workflow_state.json` 中已記錄完整 repo list + 分類 + 版號

---

## Step 3：框架版本分析 (The Framework Analyzer)

* **模型：** `vertex-claude-haiku-4-5` (New Session) — 腳本驅動，Haiku 負責執行腳本與格式化輸出
* **輸入：** Step 2 產出的每個 repo 的 `effective-pom.xml` 與 `dep-tree.txt`
* **任務：** 對**每個 repo** 執行自動化腳本分析框架版本，產出 per-repo 的 `dependency_versions.md`。
* **⚠️ 多 Repo 執行規則：** 對 `workflow_state.json` 中 `repos[]` 的每個 repo 依序執行。
* **執行方式：**
  1. 對每個 repo 執行 `scripts/autopilot/analyze_deps.py`：
     ```bash
     # 對每個 repo 分別執行
     for repo in {repo1} {repo2} ...; do
       python3 scripts/autopilot/analyze_deps.py \
         --effective-pom autopilot/{IssueID}/repos/${repo}/effective-pom.xml \
         --dep-tree autopilot/{IssueID}/repos/${repo}/dep-tree.txt \
         --output autopilot/{IssueID}/repos/${repo}/dependency_versions.md
     done
     ```
  2. 腳本自動完成（per-repo）：
     - XML 解析 `effective-pom.xml`，提取所有 `<dependency>` 的 groupId:artifactId:version:scope
     - 過濾 scope 為 `compile` 或 `runtime`（排除 `test`、`provided` 中的測試工具）
     - 依 Seed List（Spring, Hibernate, Primefaces, JSF/Mojarra, HikariCP）+ 分類規則自動歸類核心框架
     - 不在 Seed List 但符合分類的框架標註 `[Auto-detected]`
  3. Haiku Sub-agent 職責：
     - 對每個 repo 執行腳本
     - 檢查每個輸出檔案存在且非空
     - 若腳本報錯，將錯誤訊息回報主 Session
  4. **注意**：`lib` 類型的 repo（如 `-client`, `-vo`）通常框架依賴較少，分析結果可能僅有少量條目，這是正常的。

* **分類規則（內建於腳本）：**

  | 分類 | 判斷範例 |
  |------|---------|
  | Web 框架 | JSF, Primefaces, Servlet API |
  | ORM / 資料存取 | Hibernate, JPA, MyBatis |
  | 連線池 | HikariCP, C3P0, DBCP |
  | DI / 核心框架 | Spring Core, Spring Web, Spring Security |
  | 序列化 / JSON | Jackson, Gson |
  | 日誌 | SLF4J, Log4j, Logback |
  | 快取 | EhCache, Redis client |
  | 排程 | Quartz |
  | 報表 / 匯出 | Apache POI, JasperReports |
  | 安全 | Spring Security, Shiro |
  | 工具類 | Apache Commons (lang/io/collections) |

* **輸出：** 每個 repo 各一份 `autopilot/{IssueID}/repos/{repo}/dependency_versions.md`，包含兩個區塊：
  1. **Section A — 核心框架**：精簡表格，含 Category、Framework、GroupId:ArtifactId、Version、Source（Seed / Auto-detected）
  2. **Section B — 完整依賴清單**：所有 compile/runtime scope 依賴的 groupId:artifactId:version 全量清單
  - 這些檔案為 Step 7（Architect）、Step 9（Developer）、Step 11（CR）的 **必讀輸入**
  - Step 7 Architect 僅需讀取各 repo 的 **Section A**（Context 瘦身）

---

## Step 4：Jira 軌跡上傳 - Dependency Versions (The Recorder)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：** 將 Step 3 產出的框架版本分析結果上傳至 Jira Issue，建立開發軌跡。
* **輸入：** 每個 repo 的 `autopilot/{IssueID}/repos/{repo}/dependency_versions.md`
* **上傳方式（雙軌）：**
  1. **Comment Body**：所有 repo 的核心框架表格（Section A）合併寫入 Jira Comment，按 repo 分區顯示，使用 Jira Wiki Markup 格式化
  2. **檔案附件**：每個 repo 的完整 `dependency_versions.md` 以檔案形式上傳至 Jira Issue（檔名加 repo 前綴，如 `tech-issue-pom_dependency_versions.md`）
* **Comment 標題：** `[Step 3] Dependency Versions`
* **上傳指令：**
  ```bash
  # 1. 先將 Comment Body 寫入暫存檔（Jira Wiki Markup 格式）
  cat > /tmp/jira_comment_body.txt << 'COMMENT_EOF'
  [Step 3] Dependency Versions
  ...（核心框架表格內容）...
  COMMENT_EOF

  # 2. Comment + 附件一起上傳（附件失敗自動 fallback 為 Comment 內嵌）
  cd /home/node/.openclaw/workspace
  ./scripts/autopilot/jira_upload.sh comment-and-attach {IssueID} \
    --file /tmp/jira_comment_body.txt \
    autopilot/{IssueID}/repos/{repo}/dependency_versions.md
  ```
* **輸出：** Jira Comment ID + Attachment ID（記錄至 `autopilot/{IssueID}/workflow_state.json` 的 `jiraComments.step3_dependency`）
* **失敗處理：**
  1. 附件上傳失敗 → 腳本自動 fallback 將檔案內容內嵌至追加 Comment（`{code}` 區塊）
  2. Comment 上傳失敗 → 腳本自動重試 3 次（間隔 5 秒）
  3. 全部失敗 → 記錄錯誤至 `workflow_state.json`，**同時發佈一條錯誤 Comment**：`⚠️ [Step 4] Recorder 上傳失敗，請檢查 workflow_state.json 的 errors 區段`，不阻擋流水線。

---

## Step 5：資料層快照 (The Schema Collector)

* **模型：** `vertex-claude-haiku-4-5` (New Session) — 腳本驅動，Haiku 負責執行腳本、種子識別與格式化輸出
* **任務：** 在 Architect 設計之前，對**每個 repo** 透過腳本化的「**關聯追蹤**」機制自動展開所有相關資料表，同時從 **資料庫** 與 **JPA Entity/VO 源碼** 兩端提取資料層快照，建立「DB ↔ Java 映射對照表」，確保後續 SQL/JPQL 編寫基於真實欄位。
* **觸發條件：** 當需求涉及資料庫查詢或資料操作時（由主 Session 判斷），必須執行此步驟。對於**純 VO/DTO 的 lib repo**（僅定義 Java class，不含 `@Table` Entity），可跳過 Schema Collector。
* **前置條件：** Step 3（Framework Analyzer）已完成。
* **⚠️ 多 Repo 執行規則：** 對 `workflow_state.json` 中 `repos[]` 的每個包含 JPA Entity 的 repo 執行 Phase 1-3，最後 Phase 4 合併所有 repo 的結果。
* **設計原則：** 掃描範圍**不依賴 Step 0 的需求分析判斷**，而是透過腳本解析源碼 JPA 關聯註解進行確定性追蹤，自動展開至所有相關資料表，避免因需求解析遺漏導致 Architect 設計時資訊不足。
* **步驟：**

  ### Phase 1：全量 Entity 探索與關聯追蹤（per-repo 腳本化廣域掃描）

  **目的：** 對每個 repo 透過腳本建立 Entity 關聯圖，從需求相關的種子 Entity 出發，自動追蹤所有關聯表。

  1. **Haiku 識別種子 Entity（Seed Entities）**：根據 Step 0 需求分析（`jira_requirement.md`）識別每個 repo 中直接相關的 Entity 類別名稱或資料表名，作為腳本的輸入參數。
     - 從需求描述中的模組名、功能名、頁面名等關鍵字推斷
     - 若 Step 0 已提及具體資料表名，直接作為種子
     - **種子識別失敗時**：中止流水線並通知 Shaun 確認涉及的模組/資料表

  2. **對每個 repo 執行 Entity 追蹤腳本**：
     ```bash
     # 對每個包含 JPA Entity 的 repo 分別執行
     for repo in {repo1} {repo2} ...; do
       python3 scripts/autopilot/entity_tracker.py \
         --source-dir autopilot/{IssueID}/repos/${repo}/source/ \
         --seeds "TechIssue,TechIssueTag" \
         --max-depth 3 \
         --output autopilot/{IssueID}/repos/${repo}/entity_graph.json
     done
     ```
     腳本自動完成：
     - `grep -rn "@Table"` 建立全量 Entity 索引（Entity 類名 → `@Table(name="...")` 資料表名）
     - 從種子 Entity 出發，遞迴追蹤 `@ManyToOne`/`@OneToMany`/`@OneToOne`/`@ManyToMany`/`@JoinColumn`/`@JoinTable`/`@Inheritance`/`@MappedSuperclass`
     - **展開深度上限 3 層**（第 3 層若仍有密集關聯標註 `[truncated]`）
     - 產出 `entity_graph.json`：包含種子、展開路徑、最終掃描清單

  3. **Haiku 檢查掃描清單**：
     - 所有 repo 的掃描表合計超過 20 張表 → 暫停流水線，將清單發送給 Shaun 確認
     - 掃描清單合理 → 繼續 Phase 2

  ### Phase 2-3：DB Schema + JPA Entity 提取（per-repo 腳本化）

  **對每個 repo 執行 Schema 提取腳本**：
  ```bash
  for repo in {repo1} {repo2} ...; do
    python3 scripts/autopilot/schema_extractor.py \
      --entity-graph autopilot/{IssueID}/repos/${repo}/entity_graph.json \
      --source-dir autopilot/{IssueID}/repos/${repo}/source/ \
      --db-host 192.168.250.200 \
      --db-user fusion \
      --db-pass ecj84fusion \
      --db-port 3306 \
      --ssh-key /home/node/.ssh/id_ed25519 \
      --output autopilot/{IssueID}/repos/${repo}/schema_raw.json
  done
  ```
  腳本自動完成（per-repo）：
  - SSH 至 server-200，對每張表執行 `DESCRIBE` + `SHOW INDEX`
  - 若表不存在標註 ⚠️ 警告
  - 提取每個 Entity 的 `@Column`/`@JoinColumn`/`@Transient` 映射
  - 產出 `schema_raw.json`（DB 端 + JPA 端原始資料）
  - **注意**：多個 repo 可能引用同一張 DB 表（透過共用 Entity），腳本會對相同表名去重（只查一次 DB）

  ### Phase 4：合併交叉比對驗證（腳本化）

  **合併所有 repo 的 schema_raw.json 後執行比對腳本**：
  ```bash
  python3 scripts/autopilot/schema_validator.py \
    --schema-raw autopilot/{IssueID}/repos/*/schema_raw.json \
    --output autopilot/{IssueID}/db_schema_snapshot.md
  ```
  腳本自動完成：
  - 合併所有 repo 的 schema_raw.json（同表去重）
  - DB 欄位名 ↔ `@Column(name="...")` 一致性比對
  - DB 欄位型別 ↔ Java 型別相容性比對
  - 標記不一致（DB 有但 Entity 缺 / Entity 有但 DB 缺）
  - **標註 Entity 來源 repo**（方便 Architect 判斷跨 repo 的資料關聯）
  - 產出格式化的 `db_schema_snapshot.md`

  ### Haiku Sub-agent 職責摘要
  1. 識別每個 repo 的種子 Entity（需要理解需求文件）
  2. 對每個 repo 依序執行腳本（entity_tracker → schema_extractor），最後合併執行 schema_validator
  3. 根據腳本需要提供正確的 DB 連線參數（從 TOOLS.md 或主 Session 指示取得）
  4. 檢查各腳本輸出是否正常，異常時回報主 Session
  5. **跳過純 VO/DTO lib repo**（無 `@Table` 的 repo 不需要 Schema Collector）

* **輸出：** `autopilot/{IssueID}/db_schema_snapshot.md`（合併所有 repo），包含四個區塊：
  1. **關聯追蹤結果**：每個 repo 的種子 Entity、展開路徑（含層級標註 + 來源 repo 標註）、最終掃描清單
  2. **DB Schema**：所有相關資料表的完整欄位清單（欄位名、型別、NULL/NOT NULL、Key、Default）+ 索引資訊
  3. **JPA Entity 映射**：每個 Entity 的 `@Table`、`@Column`、關聯映射摘要（標註來源 repo）
  4. **DB ↔ Java 映射對照表**：逐欄位對照，標註一致性驗證結果
  - 此檔案為 Step 7（Architect）與 Step 9（Developer）的 **必讀輸入**
* **中間產出（per-repo，供除錯用）：**
  - `autopilot/{IssueID}/repos/{repo}/entity_graph.json`（Phase 1 關聯追蹤結果）
  - `autopilot/{IssueID}/repos/{repo}/schema_raw.json`（Phase 2-3 原始提取資料）
* **失敗處理：**
  - DB 連線失敗 → 中止流水線，通知 Shaun。
  - 種子 Entity 無法識別 → 中止流水線，請 Shaun 確認涉及的模組/資料表。
  - 所有 repo 掃描表合計超過 20 張表 → 暫停流水線，將掃描清單發送給 Shaun 確認是否需要縮小範圍。
  - 腳本執行錯誤 → 將 stderr 完整回報主 Session，不自行重試。

---

## Step 6：Jira 軌跡上傳 - Schema Snapshot (The Recorder)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：** 將 Step 5 產出的資料層快照上傳至 Jira Issue Comment，建立開發軌跡。
* **輸入：** `autopilot/{IssueID}/db_schema_snapshot.md`
* **Comment 標題：** `[Step 5] Schema Snapshot`
* **上傳內容：** `db_schema_snapshot.md` 完整內容，使用 Jira Wiki Markup 格式化
* **上傳指令：**
  ```bash
  # Comment + 附件一起上傳（Comment 內容為 Wiki Markup 摘要，附件為完整 md 檔案）
  cd /home/node/.openclaw/workspace

  # 準備 Comment Body（Jira Wiki Markup 格式的摘要）
  cat > /tmp/jira_comment_body.txt << 'COMMENT_EOF'
  [Step 5] Schema Snapshot
  ...（資料表清單摘要 + Entity 映射）...
  COMMENT_EOF

  # 上傳 Comment + 附件
  ./scripts/autopilot/jira_upload.sh comment-and-attach {IssueID} \
    --file /tmp/jira_comment_body.txt \
    autopilot/{IssueID}/db_schema_snapshot.md
  ```
* **輸出：** Jira Comment ID + Attachment ID（記錄至 `autopilot/{IssueID}/workflow_state.json` 的 `jiraComments.step5_schema`）
* **失敗處理：**
  1. 附件上傳失敗 → 腳本自動 fallback 將檔案內容內嵌至追加 Comment
  2. Comment 上傳失敗 → 腳本自動重試 3 次
  3. 全部失敗 → 記錄錯誤至 `workflow_state.json`，發佈錯誤 Comment，不阻擋流水線。

---

## Step 7：規格設計 (The Architect)

* **模型：** `vertex-claude-opus-4-6` think high (New Session) ⚠️ **不可用 haiku、sonnet**（規格設計需要最高品質的系統分析能力。此為流水線中唯一使用 Opus 的步驟，成本由 Context 瘦身控制。）
* **任務：** 讀取需求文件、**所有 repo** 的框架版本摘要、資料層快照與相關源碼，產出**虛擬碼級**、**多 Repo 結構**的 `autopilot/{IssueID}/implementation_spec.json`。
* **⚠️ Context 瘦身規範（降低 Opus Token 成本）：**
  - `dependency_versions.md`：每個 repo **僅送 Section A（核心框架表格）**，不送 Section B 全量清單
  - `db_schema_snapshot.md`：**僅送相關表的摘要**，不送完整原始 DESCRIBE 輸出
  - 專案源碼：**僅送 spec 涉及的檔案**，不送整個專案目錄
  - `jira_requirement.md`：全量送入（檔案小）
  - `impact_matrix.json`：全量送入（提供跨 repo 依賴全貌）
  - **目標：Input Context 控制在 30-40K tokens 以內**（多 repo 比單 repo 略多，但仍需嚴格控制）
* **框架版本約束：** Architect 在設計方案時，**必須參照每個 repo 的 `dependency_versions.md` Section A 中的核心框架版本**，確保設計方案僅使用該版本支援的 API 與特性。禁止設計需要更高版本才支援的方案。

* **🔴 Visual Anchor 分析（當附件包含 Visual Anchor 🎯 時 — 強制）：**

  Architect 在設計 spec 之前，**必須先分析所有標記為 Visual Anchor 的附件圖片**：
  1. **讀取圖片**：從 `autopilot/{IssueID}/attachments/` 載入 Visual Anchor 圖片
  2. **產出結構化佈局描述**：在 `implementation_spec.json` 的 `visualAnchorAnalysis` 區塊中記錄：
     - 佈局結構（Row/Column 座標、哪些欄位在哪些位置）
     - 儲存格合併規則（哪些 cell 被合併、合併方向與範圍）
     - 資料呈現方式（分行、對齊、格式）
     - ASCII 示意圖（必須能 1:1 對應截圖內容）
  3. **設計對照**：spec 的 `designDecisions` 必須逐項對應 `visualAnchorAnalysis` 中的每個佈局元素
  4. **衝突標註**：若技術限制導致無法完全還原截圖結構，必須在 `designConflicts` 中明確標註，不得擅自替換方案

  ```json
  {
    "visualAnchorAnalysis": {
      "screenshot-1.png": {
        "description": "Excel 匯出格式範例",
        "layout": {
          "row1": "空白/報表標題",
          "row2": "標題行 — 大分類橫向展開，A2~A3合併(立案日期)、B2~B3合併(主題)、C2~C3合併(單號)、D2~F2合併(大分類A)、G2~H2合併(大分類B)",
          "row3": "標題行 — 中分類，D3=小分類1, E3=小分類2, F3=小分類3, G3=小分類4, H3=小分類5",
          "row4_plus": "資料行 — 案件資料 + TAG細項在cell內分行顯示"
        },
        "mergeRules": [
          "A2:A3 — 立案日期標題(雙行合併)",
          "B2:B3 — 主題標題(雙行合併)",
          "C2:C3 — 單號標題(雙行合併)",
          "D2:F2 — 大分類A(橫向合併，包含3個中分類)",
          "G2:H2 — 大分類B(橫向合併，包含2個中分類)"
        ],
        "dataPresentation": "TAG細項在同一cell內以換行符分隔，非展開為多列",
        "asciiMockup": "（ASCII 示意圖）"
      }
    }
  }
  ```

* **🔴 需求忠實性約束（Requirement Fidelity — 最高優先級）：**

  **決策優先級（不可違反）：**
  1. **JIRA 驗收標準 (Acceptance Criteria)** > 實作便利性
  2. **附件截圖 Visual Anchor 分析結果** > AI 自行推論的結構
  3. **使用者明確描述的格式/佈局** > Architect 偏好的替代方案

  **Architect 行為紅線：**
  - ✅ **Architect 可以決定的**：技術實現方式（用哪個 API、哪個 Pattern、程式架構、內部資料結構）
  - ❌ **Architect 不可以改的**：使用者最終看到的結果（Excel 格式、UI 佈局、功能行為、欄位位置、合併規則）
  - ❌ **禁止以下理由自行變更需求**：「程式邏輯簡單」、「效能更好」、「更好維護」、「使用者可能更喜歡」
  - 當需求與技術限制**真正衝突**時（例如框架不支援、效能會導致 OOM），Architect 必須在 spec 的 `designConflicts` 區塊中明確標註衝突點與替代方案，由主 Session 提交 Shaun 決策，**不得擅自選擇替代方案**

* **🔴 需求覆蓋矩陣（Requirement Coverage Matrix — 強制）：**

  `implementation_spec.json` 必須包含 `requirementCoverage` 區塊，逐項對照 `jira_requirement.md` 中的**每一條驗收標準**：

  ```json
  {
    "requirementCoverage": [
      {
        "source": "格式驗收 #1",
        "requirement": "Tag 分類採用階層式結構（大分類 D2 - 中分類 D3 - 細項 D4+）",
        "specDesign": "Excel Row 1-2 為雙行標題，D 欄起橫向展開大分類/中分類",
        "changeIds": ["C1", "C3"],
        "covered": true
      },
      {
        "source": "格式驗收 #2",
        "requirement": "多個中分類的大分類標題自動合併儲存格",
        "specDesign": "使用 CellRangeAddress 合併大分類 header cells",
        "changeIds": ["C3"],
        "covered": true
      }
    ]
  }
  ```

  **規則：**
  - 必須涵蓋 `jira_requirement.md` 中**所有**功能驗收、格式驗收、資料驗收項目
  - `covered: false` 的項目**必須**附上 `reason`（技術衝突原因）和 `resolution`（「待 Shaun 確認」或具體替代方案），否則 spec 視為不合格
  - 主 Session 在收到 spec 後，**第一步就是檢查 `requirementCoverage`**，任何 `covered: false` 項目需提交 Shaun 審核

* **核心規範：**
  - 必須列出修改檔案清單（完整路徑）。
  - **必須產出虛擬碼級的變更描述**（詳見下方「虛擬碼規範」）。
  - 必須進行潛在影響分析（哪些模組可能受影響）。
  - 必須標註預期的驗收測試方式。
  - 必須針對效能部份特別加強設計，例如批次查詢及設計適當的資料庫索引。
  - **SQL/JPQL 欄位強制驗證** — 如果 spec 中包含任何查詢邏輯，Architect 必須在 spec 中附上 `sqlValidation` 區塊：
    - **Native SQL**：每個 `table.column` 必須在 `db_schema_snapshot.md` 的 **DB Schema 區塊** 中存在。
    - **JPQL/HQL**：每個 `entity.property` 必須在 `db_schema_snapshot.md` 的 **JPA Entity 映射區塊** 中存在。
    - 逐一列出並標註驗證結果（✅ 存在 / ❌ 不存在）。任何 ❌ 項目視為 spec 未通過，禁止進入 Step 7。
    - 特別注意：**Native SQL 中使用 DB 欄位名，JPQL 中使用 Java 屬性名**，兩者不可混用。
  - **DB Migration 定義** — 如果需求涉及資料庫結構異動（新增/修改/刪除欄位、新增資料表、修改索引等），Architect **必須**在 `implementation_spec.json` 中附上 `dbMigration` 區塊：
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
  - **Properties Migration 定義** — 如果需求涉及外掛 config 異動（`/home/fusion-ap/config/` 目錄下的 `.properties` 檔案），Architect **必須**在 `implementation_spec.json` 中附上 `propertiesMigration` 區塊：
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
    - 如果不確定 properties 檔案名稱或現有內容，必須在 Step 3 中一併提取
  - **Test Plan 定義** — Architect **必須**在 `implementation_spec.json` 中附上 `testPlan` 區塊，定義基於需求驗收標準與設計規格的測試案例：
    ```json
    {
      "testPlan": {
        "setupData": {
          "database": "fusion",
          "port": 3306,
          "statements": [
            "INSERT INTO tech_issue (id, subject) VALUES (99999, 'Autopilot Test Data');",
            "INSERT INTO tech_issue_tag (issue_id, tag_id) VALUES (99999, 101), (99999, 102), (99999, 101);"
          ]
        },
        "testCases": [
          {
            "id": "TC1",
            "category": "api",
            "description": "查詢標籤統計 API 回傳正確數據",
            "steps": [
              "curl -s http://ai_lab.shaun.lab/api/tech-issue/99999/tag-stats"
            ],
            "expectedResult": "HTTP 200, JSON 包含 tag_id=101 count=2, tag_id=102 count=1",
            "verificationMethod": "curl + jq 驗證 response body"
          },
          {
            "id": "TC2",
            "category": "manual",
            "description": "頁面上標籤統計區塊顯示正確數字",
            "steps": [
              "瀏覽器開啟 tech-issue 編輯頁面 (issue_id=99999)",
              "點擊「標籤統計」Tab"
            ],
            "expectedResult": "統計表格顯示 tag 名稱與對應數量",
            "verificationMethod": "人工目視確認"
          }
        ],
        "cleanupSQL": {
          "database": "fusion",
          "port": 3306,
          "statements": [
            "DELETE FROM tech_issue_tag WHERE issue_id = 99999;",
            "DELETE FROM tech_issue WHERE id = 99999;"
          ]
        }
      }
    }
    ```
    - `setupData`：測試前的數據準備 SQL（在 Step 15 部署後驗證階段開頭執行）
    - `testCases`：測試案例清單，每個案例包含 id、category、description、steps、expectedResult、verificationMethod
      - `category` 分類：
        - `api`：REST API 端點驗證（curl 打端點，驗 response body/status）
        - `db`：資料庫查詢結果驗證（執行 SQL，驗回傳資料是否符合預期）
        - `page`：頁面載入驗證（curl 頁面 URL，驗 HTTP 200 + 頁面關鍵元素）
        - `manual`：需人工確認項目（UI 互動、視覺排版等無法自動化的驗證）
      - `api`/`db`/`page` 類型由 Step 15 自動執行
      - `manual` 類型彙整為人工確認清單，在 Step 17 Jira Comment 中以醒目格式標示
    - `cleanupSQL`：測試數據清理 SQL（**不自動執行**，Step 15 產出為 `test_cleanup.sh` 腳本，由 Shaun 手動決定何時執行）
    - Architect 設計測試案例時，必須基於 `jira_requirement.md` 的驗收標準與 `implementation_spec.json` 的功能邏輯
    - `setupData` 使用的測試 ID 應選用不與生產數據衝突的值（如 99999 開頭的 ID）
  - ⚠️ **強制人工確認（加強版）** — 主 Session 收到 Architect 的草案後，必須執行以下審核流程：
    1. **需求覆蓋矩陣審查**：檢查 `requirementCoverage` 中是否有 `covered: false` 項目，有則標記為紅色警告
    2. **視覺一致性審查**（若需求涉及 UI/Excel/報表格式）：
       - 對比 `jira_requirement.md` 的 Visual Anchor 描述與 spec 的 `visualAnchorAnalysis` + `designDecisions` 中的 ASCII 示意圖
       - 若兩者結構不一致（例如 JIRA 要求合併儲存格，spec 寫不合併），**強制攔截**，不允許直接 PASS
    3. **示意圖確認**（若 JIRA 需求明確要求「先提供示意圖確認」）：將 ASCII 示意圖發送給 Shaun，等待確認後才繼續
    4. **標準審核項目**：Shaun 審核 SDD 整體設計、`dbMigration`/`propertiesMigration` 的正確性、`testPlan` 的覆蓋率
    5. 獲得 Shaun 批准後才進入 Step 8

* **⚠️ 多 Repo Spec 結構規範：**

  `implementation_spec.json` 的頂層結構**必須**包含 `repos[]` 陣列，即使只有一個 repo：

  ```json
  {
    "issueId": "QOP-XXXX",
    "repos": [
      {
        "project": "tech-issue-client",
        "scmUrl": "http://scm.shaun.lab:8000/scm/hg/tech-issue-client",
        "branch": "branch-QOP-XXXX-autopilot",
        "type": "lib",
        "buildOrder": 1,
        "deployOrder": null,
        "jenkinsJob": "build-lib_tech-issue-client",
        "jenkinsParams": {
          "Select": "Self",
          "RevisionType": "BRANCH",
          "Revision": "branch-QOP-XXXX-autopilot",
          "REPO_URL": "http://scm.shaun.lab:8000/scm/hg/tech-issue-client",
          "MAVEN_COMMAND": "clean deploy"
        },
        "versionChange": {
          "from": "1.5.0-SNAPSHOT",
          "to": "1.6.0-SNAPSHOT"
        },
        "modifiedFiles": [...]
      },
      {
        "project": "tech-issue-pom",
        "scmUrl": "http://scm.shaun.lab:8000/scm/hg/tech-issue-pom",
        "branch": "branch-QOP-XXXX-autopilot",
        "type": "service",
        "buildOrder": 2,
        "deployOrder": 1,
        "jenkinsJob": "AI_WERP_DEV_BOT_DEPLOY_tech-issue-pom(web+rest)(ai_lab)",
        "jenkinsParams": {
          "Select": "Self",
          "RevisionType": "BRANCH",
          "Revision": "branch-QOP-XXXX-autopilot",
          "Env": "192.168.250.200"
        },
        "modifiedFiles": [...]
      },
      {
        "project": "portal-pom",
        "scmUrl": "http://scm.shaun.lab:8000/scm/hg/portal-pom",
        "branch": "branch-QOP-XXXX-autopilot",
        "type": "service",
        "buildOrder": 3,
        "deployOrder": 2,
        "jenkinsJob": "AI_WERP_DEV_BOT_DEPLOY_portal-pom(web)(ai_lab)",
        "jenkinsParams": {
          "Select": "Self",
          "RevisionType": "BRANCH",
          "Revision": "branch-QOP-XXXX-autopilot",
          "Env": "192.168.250.200"
        },
        "pomDependencyUpdates": [
          {
            "groupId": "com.cy",
            "artifactId": "tech-issue-client",
            "from": "1.5.0-SNAPSHOT",
            "to": "1.6.0-SNAPSHOT"
          }
        ],
        "modifiedFiles": [...]
      }
    ],
    "crossRepoDependencies": [
      {
        "from": "portal-pom",
        "to": "tech-issue-client",
        "type": "maven-compile",
        "description": "portal-pom 引用 tech-issue-client 的 REST Client 介面"
      }
    ],
    "runtimeDependencies": [
      {
        "consumer": "portal-pom",
        "provider": "tech-issue-pom",
        "type": "rest-api",
        "via": "tech-issue-client",
        "description": "portal 透過 tech-issue-client 呼叫 tech-issue-rest API"
      }
    ],
    "dbMigration": { ... },
    "propertiesMigration": { ... },
    "testPlan": { ... }
  }
  ```

  **⚠️ `buildOrder` vs `deployOrder` 說明：**
  - `buildOrder`：Maven 編譯順序（lib → Nexus 先，消費端後）。Step 14 Phase 1 (BUILD_LIB) + Phase 2 (DEPLOY 的 Jenkins build) 依此順序
  - `deployOrder`：Runtime 部署上線順序（API 提供端先上線，消費端後上線）。Step 14 Phase 2 的**服務啟動驗證**依此順序。`type=lib` 的 `deployOrder` 為 `null`（lib 不需要部署，只需上傳 Nexus）
  - `runtimeDependencies`：標記 service 之間的 HTTP/REST 呼叫關係，確保 provider 在 consumer 之前部署完成

  **`repos[]` 各欄位說明：**

  | 欄位 | 說明 |
  |------|------|
  | `project` | SCM 專案名稱 |
  | `scmUrl` | SCM 完整 URL |
  | `branch` | 分支名稱（所有 repo 使用統一的 `branch-{IssueID}-autopilot`） |
  | `type` | `service`（部署 WAR）或 `lib`（發佈 JAR 至 Nexus） |
  | `buildOrder` | Maven 編譯順序（lib 先於消費它的 service，確保 Nexus 上有正確的 JAR） |
  | `deployOrder` | Runtime 部署順序（API 提供端先於消費端）。`type=lib` 為 `null`。**Step 14 Phase 2 依此順序部署** |
  | `jenkinsJob` | Jenkins Job 名稱（`type=service` 對應 `AI_WERP_DEV_BOT_DEPLOY_*`，`type=lib` 對應 `build-lib_*`） |
  | `jenkinsParams` | Jenkins 觸發參數（`service` 有 `Env`，`lib` 有 `REPO_URL` + `MAVEN_COMMAND`） |
  | `versionChange` | **僅 `type=lib`**：POM 版本號變更（from → to，to 必須為 Shaun 確認的 A.B.C-SNAPSHOT） |
  | `pomDependencyUpdates` | **僅消費端**：需要更新的 Maven dependency 版本（groupId + artifactId + from → to） |
  | `modifiedFiles` | 該 repo 中需要修改的檔案清單（含虛擬碼） |

  **Architect 多 Repo 專屬規範：**
  1. **Lib 的 POM 版本變更**必須作為 `modifiedFiles` 的第一項（`pom.xml` 的 `<version>` 修改）
  2. **消費端的 POM 依賴更新**必須作為 `modifiedFiles` 的第一項（`pom.xml` 中對應 dependency 的 `<version>` 修改）
  3. **`buildOrder` 必須正確**：所有 `type=lib` 的 buildOrder 必須小於依賴它的 `type=service`
  4. **`deployOrder` 必須正確**：API 提供端的 deployOrder 必須小於消費端。`type=lib` 的 deployOrder 為 `null`
  5. **`crossRepoDependencies`** 必須列出所有跨 repo 的 Maven 依賴關係，以確保 CR 可驗證接口一致性
  6. **`runtimeDependencies`** 必須列出所有跨 service 的 REST API 呼叫關係（consumer → provider），標註 `via`（透過哪個 Client Lib）
  7. **`jenkinsJob` 名稱**必須從 `impact_matrix.json` 中取得（已由腳本驗證 Job 存在性）
  8. **Cross-Service API 合約一致性**：當 spec 涉及跨服務 API 串接時，Architect 必須確保：
     - Client Lib 中的 REST Client 方法簽名（URL、HTTP Method、Request/Response DTO）
     - 與 Provider Service 的 REST Controller 端點定義完全一致
     - 在 `modifiedFiles` 中明確標註對應關係（例如 C3 的 Client 方法對應 C7 的 Controller 端點）

* **虛擬碼規範（Pseudo-Code Specification）：**

  **⚠️ 此為 Step 9（Developer，haiku）的直接輸入。Spec 越詳細，haiku 實作越準確，CR 迭代越少。**

  每個 repo 的 `modifiedFiles` 中，每個修改檔案的 `changes` 陣列中，每個變更項必須包含：

  ```json
  {
    "modifiedFiles": [
      {
        "path": "src/main/java/.../TechIssueService.java",
        "changeType": "MODIFY",
        "changes": [
          {
            "id": "C1",
            "location": "新增方法，位於 class body 末尾",
            "pseudoCode": [
              "public List<TagStatDTO> getTagStatistics(Long issueId) {",
              "  // 1. 用 entityManager 建立 Native SQL Query",
              "  //    SQL: SELECT t.tag_id, m.tag_name, COUNT(*) as cnt",
              "  //         FROM tech_issue_tag t",
              "  //         JOIN tag_master m ON t.tag_id = m.id",
              "  //         WHERE t.issue_id = :issueId",
              "  //         GROUP BY t.tag_id, m.tag_name",
              "  // 2. query.setParameter(\"issueId\", issueId)",
              "  // 3. 執行 query.getResultList() 取得 List<Object[]>",
              "  // 4. 遍歷結果，每行轉為 new TagStatDTO(tagId, tagName, count)",
              "  // 5. return resultList",
              "}"
            ],
            "dependencies": ["C3（TagStatDTO 類別）"],
            "sqlValidation": "tech_issue_tag.tag_id ✅, tag_master.tag_name ✅, tech_issue_tag.issue_id ✅"
          },
          {
            "id": "C2",
            "location": "注入 EntityManager（若類別中尚未存在）",
            "pseudoCode": [
              "@PersistenceContext",
              "private EntityManager entityManager;"
            ],
            "dependencies": [],
            "sqlValidation": null
          }
        ]
      },
      {
        "path": "src/main/java/.../TagStatDTO.java",
        "changeType": "ADD",
        "changes": [
          {
            "id": "C3",
            "location": "新增檔案",
            "pseudoCode": [
              "public class TagStatDTO implements Serializable {",
              "  private Long tagId;",
              "  private String tagName;",
              "  private Long count;",
              "  // constructor(Long tagId, String tagName, Long count)",
              "  // getter/setter for all fields",
              "}"
            ],
            "dependencies": [],
            "sqlValidation": null
          }
        ]
      }
    ]
  }
  ```

  **虛擬碼必備要素：**
  | 要素 | 說明 | 範例 |
  |------|------|------|
  | **變更 ID** | 每個變更點的唯一識別碼 | `C1`, `C2`, `C3` |
  | **方法簽名** | 完整的 public/private、回傳型別、參數列表 | `public List<TagStatDTO> getTagStatistics(Long issueId)` |
  | **資料流** | 輸入什麼、處理步驟、回傳什麼 | `// 1. 建立 Query → 2. 設參數 → 3. 執行 → 4. 轉 DTO → 5. return` |
  | **完整 SQL/JPQL** | 不可用「查詢相關資料」帶過，必須寫出完整語句 | `SELECT t.tag_id, m.tag_name, COUNT(*) ...` |
  | **依賴關係** | 跨檔案的變更依賴（C1 需要 C3 的類別） | `"dependencies": ["C3"]` |
  | **SQL 驗證結果** | 引用 `db_schema_snapshot.md` 中的驗證結果 | `tech_issue_tag.tag_id ✅` |
  | **JSF 綁定**（若適用） | EL 表達式與 Bean 方法的對應關係 | `#{techIssueBean.tagStats}` → `getTagStats()` |
  | **位置描述** | 在哪裡插入/修改（類別末尾、某方法後面、某行替換） | `新增方法，位於 class body 末尾` |

  **禁止事項：**
  - ❌ `"description": "新增標籤統計方法"`（太模糊，Haiku 無法實作）
  - ❌ SQL 中使用未經 `db_schema_snapshot.md` 驗證的欄位名
  - ❌ 省略 DTO/VO 的欄位定義
  - ❌ 省略方法參數或回傳型別

* **輸出：** `autopilot/{IssueID}/implementation_spec.json`

---

## Step 8：Jira 軌跡上傳 - Implementation Spec (The Recorder)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **前置條件：** Shaun 已審核通過 Step 7 產出的 `implementation_spec.json`。
* **任務：** 將已審核通過的規格設計文件上傳至 Jira Issue Comment，建立開發軌跡。
* **輸入：** `autopilot/{IssueID}/implementation_spec.json`
* **Comment 標題：** `[Step 7] Implementation Spec (Approved)`
* **上傳內容：** `implementation_spec.json` 完整內容，使用 Jira Wiki Markup 格式化
* **上傳指令：**
  ```bash
  cd /home/node/.openclaw/workspace

  # 準備 Comment Body（Jira Wiki Markup 格式）
  cat > /tmp/jira_comment_body.txt << 'COMMENT_EOF'
  [Step 7] Implementation Spec (Approved)
  ...（修改檔案清單 + 規格摘要）...
  COMMENT_EOF

  # 上傳 Comment + 附件（implementation_spec.json 作為附件）
  ./scripts/autopilot/jira_upload.sh comment-and-attach {IssueID} \
    --file /tmp/jira_comment_body.txt \
    autopilot/{IssueID}/implementation_spec.json
  ```
* **輸出：** Jira Comment ID + Attachment ID（記錄至 `autopilot/{IssueID}/workflow_state.json` 的 `jiraComments.step7_spec`）
* **失敗處理：**
  1. 附件上傳失敗 → 腳本自動 fallback 將檔案內容內嵌至追加 Comment
  2. Comment 上傳失敗 → 腳本自動重試 3 次
  3. 全部失敗 → 記錄錯誤至 `workflow_state.json`，發佈錯誤 Comment，不阻擋流水線。

---

## Step 9：程式實作 (The Developer)

* **模型：** `vertex-claude-haiku-4-5` (New Session) — 依據 Step 7 虛擬碼級 spec 進行「照表施工」
* **⚠️ 多 Repo 執行規則：** 對 `implementation_spec.json` 中 `repos[]` 的**每個 repo 各開一個獨立 Sub-agent**。按 `buildOrder` 順序執行（先 lib 後 service），但同 buildOrder 的 repo 可平行執行。
* **任務（per-repo）：**
  1. 切換至對應 repo 的工作目錄（`autopilot/{IssueID}/repos/{repo}/source/`）
  2. 開立新分支：
     ```bash
     hg update testing   # 或 default（視 repo 而定）
     hg branch branch-{IssueID}-autopilot
     ```
  3. **若為 `type=lib` 且有 `versionChange`**：先修改 `pom.xml` 的 `<version>` 為新版本號（如 `2.2.0-SNAPSHOT`）
  4. **若有 `pomDependencyUpdates`**：修改 `pom.xml` 中對應 dependency 的 `<version>`
  5. 依據 spec 中**該 repo** 的 `modifiedFiles` 裡的**虛擬碼**進行程式碼實作。
* **實作原則（Haiku 專用約束）：**
  - **逐項實作**：按照 spec 中的變更 ID（C1, C2, C3...）逐一實作，不可跳過任何一項。
  - **照表施工**：虛擬碼中的方法簽名、SQL/JPQL、資料流步驟必須**忠實轉換**為實際程式碼，不可自行「優化」或「改寫」邏輯。
  - **Visual Anchor 繼承**：若 `implementation_spec.json` 包含 `visualAnchorAnalysis` 區塊，Developer 必須將其視為 **Highest Truth（最高準則）**：
    - 生成的程式碼邏輯（如 POI 的 Row/Column 座標、CellRangeAddress 合併範圍）必須能 **1:1 還原** `visualAnchorAnalysis` 中描述的結構
    - 當虛擬碼的細節與 `visualAnchorAnalysis` 描述不一致時，以 `visualAnchorAnalysis` 為準，並立即中止回報主 Session
    - ⚠️ Developer（Haiku）**不需要也不應該**直接分析圖片檔案，所有視覺資訊已由 Step 7（Opus）轉為結構化文字
  - **完成自查**：實作完成後，自行比對 spec 中的每個變更 ID，確認全部已實作。以下格式輸出自查結果：
    ```
    ## 實作自查 (repo: tech-issue-pom)
    - C1: ✅ TechIssueService.getTagStatistics() 已實作
    - C2: ✅ EntityManager 注入已存在（原本就有，跳過）
    - D1: ✅ pom.xml dependency version 已更新
    ```
* **嚴格約束：** 僅能修改 `implementation_spec.json` 中該 repo 指定範圍，嚴禁額外重構或調整，以確保 Context 精簡與邏輯專一。每個 Developer Sub-agent **只看自己 repo 的 spec 區段**，不跨 repo 作業。
* **框架版本約束：** Developer 在編寫程式碼時，**必須參照 `autopilot/{IssueID}/repos/{repo}/dependency_versions.md` Section A 中的核心框架版本**，使用該版本支援的 API 與寫法，禁止使用更高版本才有的特性。
* **SQL/JPQL 欄位約束：** Developer 在編寫查詢時，**必須參照 `autopilot/{IssueID}/db_schema_snapshot.md`**：
  - **Native SQL** → 使用 DB Schema 區塊中的真實 DB 欄位名（`@Column(name="...")` 的值）
  - **JPQL/HQL** → 使用 JPA Entity 映射區塊中的 Java 屬性名
  - **禁止「猜測」欄位名稱**。如果所需欄位在 schema 快照中不存在，必須立即中止並回報主 Session。
  - 可參照「DB ↔ Java 映射對照表」確認 DB 欄位名與 Java 屬性名的對應關係。
* **輸出（per-repo）：**
  - 修改完成的原始碼（僅限 spec 指定的檔案）
  - 實作自查清單（每個變更 ID 的完成狀態）

---

## Step 10：代碼同步 (The Committer)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **⚠️ 多 Repo 執行規則：** 對每個 repo 各開獨立 Sub-agent 執行 commit + push。可平行執行（commit/push 彼此獨立）。
* **任務（per-repo）：**
  1. 切換至對應 repo 的工作目錄（`autopilot/{IssueID}/repos/{repo}/source/`）
  2. `hg add`（新增檔案時）
  3. `hg commit -m "[{IssueID}] {需求摘要}"`
  4. `hg push http://******:******@scm.shaun.lab:8000/scm/hg/{repo}`
* **Commit Message 規範：** `[{IssueID}] {一句話需求摘要}`
* **輸出：** 每個 repo 在 SCM 上可見的新 changeset。

---

## Step 11：品質審計 (The Inspector - CR)

* **模型：** `vertex-claude-haiku-4-5` (New Session) — 腳本驅動自動化檢查 + Haiku 邏輯審查
* **⚠️ 設計原則：** 由於 Step 9 使用 Haiku 實作，CR 必須**加強逐筆驗證**，確保 Haiku 確實依照 spec 完整實作所有變更項。機械性檢查由腳本自動完成（確定性、零遺漏），Haiku 專注於邏輯層面的審查。
* **⚠️ 多 Repo 執行規則：** 階段 A + A2 的腳本化檢查 **per-repo** 執行，階段 B 的邏輯審查做**跨 repo 整合審查**（特別關注接口一致性）。
* **CR 分為兩階段：**

  ### 階段 A：自動化腳本檢查（per-repo 機械性驗證，6 項）

  **對每個 repo 執行 CR 自動化腳本：**
  ```bash
  for repo in {repo1} {repo2} ...; do
    python3 scripts/autopilot/cr_automated_checks.py \
      --spec autopilot/{IssueID}/implementation_spec.json \
      --spec-repo ${repo} \
      --schema autopilot/{IssueID}/db_schema_snapshot.md \
      --deps autopilot/{IssueID}/repos/${repo}/dependency_versions.md \
      --source-dir autopilot/{IssueID}/repos/${repo}/source/ \
      --diff "$(cd autopilot/{IssueID}/repos/${repo}/source/ && hg diff -r 'ancestor(testing, .)':. --stat)" \
      --output autopilot/{IssueID}/repos/${repo}/cr_auto_report.json
  done
  ```

  腳本自動檢查項目：
  1. **SQL/JPQL Schema 驗證**：提取程式碼中所有 SQL/JPQL 語句，與 `db_schema_snapshot.md` 交叉比對（DB 欄位名 vs Java 屬性名，是否混用）
  2. **XHTML/CDATA 檢查**：掃描所有修改的 `.xhtml` 檔案，確認 `<script>` 區塊包含 CDATA 包裹
  3. **安全性模式掃描**：grep SQL injection 模式（字串拼接 SQL）、XSS 模式（未跳脫輸出）
  4. **修改範圍比對**：`hg diff` 的檔案清單 vs spec 指定的檔案清單，標記未預期的額外修改
  5. **框架版本相容掃描**：比對程式碼中的 import/annotation 是否與 `dependency_versions.md` Section A 中的版本相容
  6. **基本語法檢查**：Java import 是否完整、括號是否匹配等

  **腳本輸出 `cr_auto_report.json`：**
  ```json
  {
    "checks": [
      {"name": "sql_schema_validation", "status": "PASS|FAIL", "details": [...]},
      {"name": "xhtml_cdata", "status": "PASS|FAIL|SKIP", "details": [...]},
      {"name": "security_patterns", "status": "PASS|WARN", "details": [...]},
      {"name": "scope_compliance", "status": "PASS|WARN", "details": [...]},
      {"name": "framework_compat", "status": "PASS|FAIL", "details": [...]},
      {"name": "syntax_basic", "status": "PASS|FAIL", "details": [...]}
    ],
    "criticalFailures": 0,
    "warnings": 0
  }
  ```

  **任何 FAIL 項目即為 CR 失敗（Critical）**，Haiku 必須產出 `fix_list.md` 導回 Step 9，不進入階段 B。

  ### 階段 A2：Spec 合規矩陣（per-repo 逐筆驗證 — 核心防線）

  **⚠️ 此為 Step 9 降級到 Haiku 後最關鍵的品質保障。**

  **對每個 repo 執行 Spec 合規矩陣腳本：**
  ```bash
  for repo in {repo1} {repo2} ...; do
    python3 scripts/autopilot/cr_spec_compliance.py \
      --spec autopilot/{IssueID}/implementation_spec.json \
      --spec-repo ${repo} \
      --diff <(cd autopilot/{IssueID}/repos/${repo}/source/ && hg diff -r 'ancestor(testing, .)':.) \
      --source-dir autopilot/{IssueID}/repos/${repo}/source/ \
      --output autopilot/{IssueID}/repos/${repo}/cr_compliance_matrix.md
  done
  ```

  腳本自動完成：
  1. 從 `implementation_spec.json` 提取所有變更項（C1, C2, C3...），包含：
     - 檔案路徑、changeType、變更描述
     - 虛擬碼中的關鍵特徵（方法名、類名、SQL 片段、欄位名）
  2. 從 `hg diff` 提取所有實際修改的檔案與變更行
  3. **逐筆比對**，產出合規矩陣：

  ```markdown
  ## Spec 合規矩陣

  | ID | Spec 要求 | 目標檔案 | 狀態 | 驗證依據 |
  |----|----------|---------|------|---------|
  | C1 | 新增 getTagStatistics() | TechIssueService.java | ✅ 已實作 | diff 中發現方法定義 |
  | C2 | 注入 EntityManager | TechIssueService.java | ⏭️ 已存在 | 原始碼中已有 @PersistenceContext |
  | C3 | 新增 TagStatDTO | TagStatDTO.java | ❌ 未實作 | 檔案不存在於 diff 中 |
  | -- | （未在 spec 中） | SomeOther.java | ⚠️ 額外修改 | diff 中出現但 spec 未要求 |

  ### 判定結果
  - ❌ 未實作項目：1（C3）
  - ⚠️ 額外修改：1
  - **判定：FAIL — 回 Step 9 補實作 C3**
  ```

  **判定規則：**
  - 任何 ❌（spec 要求但未實作）→ **CR FAIL**，產出 `fix_list.md` 回 Step 9
  - 任何 ⚠️（spec 未要求的額外修改）→ Haiku 判斷是否合理（可能是必要的 import 補充等），合理則 PASS 並附說明
  - 全部 ✅ 或 ⏭️ → 進入階段 B

  ### 階段 B：Haiku 邏輯審查（人工智慧層 — 跨 Repo 整合）

  **前提：所有 repo 的階段 A + A2 全部通過後才進入。**

  Haiku 閱讀**所有 repo** 的實際程式碼（`hg diff` 輸出），進行以下邏輯層面的審查：
  1. **效能：** N+1 Query、死循環、不必要的內存占用
  2. **邏輯正確性：** 虛擬碼的意圖是否被正確轉換為實際程式碼（不只是「有寫」，而是「寫對了」）
  3. **邊界條件：** null 檢查、空集合處理、異常處理
  4. **JSF 整合**（若適用）：EL 表達式與 Bean 方法的綁定是否正確
  5. **⚠️ 跨 Repo 接口一致性**（多 Repo 時必查）：
     - lib 中新增/修改的 class/method 簽名，是否與消費端引用一致
     - `pomDependencyUpdates` 的版本號是否與 lib 的 `versionChange.to` 一致
     - VO/DTO 的欄位定義在 lib 與消費端之間是否匹配
  6. **⚠️ Cross-Service API 合約驗證**（當 `runtimeDependencies` 存在時必查）：
     - Client Lib 中 REST Client 方法的 URL Path、HTTP Method 是否與 Provider Service 的 REST Controller `@RequestMapping` 一致
     - Request DTO / Response DTO 的欄位定義是否在 Client 與 Controller 兩端匹配
     - `deployOrder` 是否正確（provider.deployOrder < consumer.deployOrder）

* **輸出：**
  - CR 通過：`autopilot/{IssueID}/cr_result.md`（含自動化報告 + 合規矩陣 + 邏輯審查摘要）
  - CR 失敗：`autopilot/{IssueID}/cr_result.md` + `autopilot/{IssueID}/fix_list.md`
* **流程：**
  - CR 通過 → 進入Step 12（上傳 CR 結果）。
  - CR 失敗 → 進入Step 12（上傳 CR 結果），再導回Step 9 修正。
* **迭代上限：** 最多 **3 次**。超過 3 次 CR 仍未通過，立即中止流水線並通知 Shaun 人工介入，附上所有 `fix_list.md` 記錄與合規矩陣。

---

## Step 12：Jira 軌跡上傳 - CR 結果 (The Recorder)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：** 將 Step 11 的品質審計結果上傳至 Jira Issue Comment，建立開發軌跡。
* **輸入：** `autopilot/{IssueID}/cr_result.md`（+ `fix_list.md`，若 CR 失敗）
* **Comment 標題：**
  - CR 通過：`[Step 11] CR Passed`
  - CR 失敗：`[Step 11] CR Failed (Iteration N)`
* **上傳內容：** CR 審計結果摘要（含通過/失敗項目），若失敗則附 `fix_list.md` 內容
* **上傳指令：**
  ```bash
  cd /home/node/.openclaw/workspace

  # 準備 Comment Body（Jira Wiki Markup 格式）
  cat > /tmp/jira_comment_body.txt << 'COMMENT_EOF'
  [Step 11] CR Passed ✅
  ...（審查結果表格 + 通過/失敗項目）...
  COMMENT_EOF

  # 上傳 Comment + 附件（cr_result.md 作為附件）
  ./scripts/autopilot/jira_upload.sh comment-and-attach {IssueID} \
    --file /tmp/jira_comment_body.txt \
    autopilot/{IssueID}/cr_result.md
  ```
* **輸出：** Jira Comment ID + Attachment ID（記錄至 `autopilot/{IssueID}/workflow_state.json` 的 `jiraComments.step11_cr`）
* **失敗處理：**
  1. 附件上傳失敗 → 腳本自動 fallback 將檔案內容內嵌至追加 Comment
  2. Comment 上傳失敗 → 腳本自動重試 3 次
  3. 全部失敗 → 記錄錯誤至 `workflow_state.json`，發佈錯誤 Comment，不阻擋流水線。
* **後續流程：**
  - CR 通過 → 進入Step 13（若有 migration）或Step 14（無 migration）。
  - CR 失敗 → 導回Step 9 修正。

---

## Step 13：環境變更預備 (The Migrator)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **觸發條件：** `implementation_spec.json` 中存在 `dbMigration` 或 `propertiesMigration` 區塊時執行。若兩者皆不存在，跳過此步驟直接進入 Step 14。
* **任務：** 在 Jenkins 部署（Step 12）之前，先至 server-200 完成 DB Schema 異動與 Properties 變更，並產出完整的 rollback 資料包。完成後將 migration 與 rollback 內容上傳至 Jira Issue Comment。
* **步驟：**

  ### A. 備份（不可跳過）

  #### A1. DB Schema 備份（當 `dbMigration` 存在時）
  1. SSH 至 server-200，對 `dbMigration.affectedTables` 中每張表執行：
     ```bash
     ssh -i ~/.ssh/id_ed25519 root@192.168.250.200
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
  4. **⚠️ 不在此步驟重啟容器** — 容器重啟由 Step 14（Jenkins 部署）統一處理。Properties 變更將在容器重啟後生效。

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
     scp rollback.sql root@192.168.250.200:/tmp/
     ssh root@192.168.250.200
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

  ### E. 上傳至 Jira Issue Comment
  1. 準備 Comment Body（Jira Wiki Markup），包含：
     - `migration.sql` 完整內容
     - `rollback.sql` 完整內容
     - Properties 變更清單（若有）
     - 驗證結果
  2. 使用統一上傳腳本：
     ```bash
     cd /home/node/.openclaw/workspace

     # 準備 Comment Body
     cat > /tmp/jira_comment_body.txt << 'COMMENT_EOF'
     [Step 13] Migration Executed ✅
     ...（migration.sql + rollback.sql + 驗證結果）...
     COMMENT_EOF

     # 上傳 Comment + migration.sql 作為附件
     ./scripts/autopilot/jira_upload.sh comment-and-attach {IssueID} \
       --file /tmp/jira_comment_body.txt \
       autopilot/{IssueID}/migration.sql

     # 額外上傳 rollback.sql 作為附件
     ./scripts/autopilot/jira_upload.sh attach {IssueID} \
       autopilot/{IssueID}/rollback.sql
     ```
  3. 將 Comment ID 記錄至 `workflow_state.json` 的 `jiraComments.step13_migration`。

* **輸出：**
  - `autopilot/{IssueID}/migration.sql`（正向 migration SQL）
  - `autopilot/{IssueID}/migration_properties.md`（Properties 變更清單）
  - `autopilot/{IssueID}/rollback.sql`（反向 rollback SQL）
  - `autopilot/{IssueID}/rollback_properties.md`（Properties 還原清單）
  - `autopilot/{IssueID}/rollback_guide.md`（完整人工還原 SOP）
  - `autopilot/{IssueID}/backup/`（變更前備份檔案）
  - Jira Comment ID
* **失敗處理：**
  - DB Migration 執行失敗 → 立即執行 `rollback.sql`，還原 properties 備份，中止流水線通知 Shaun。
  - SSH 連線失敗 → 中止流水線通知 Shaun。
  - Properties 檔案不存在 → 中止流水線通知 Shaun（可能路徑錯誤）。
  - Jira Comment 上傳失敗 → 記錄錯誤，不阻擋流水線。

---

## Step 14：自動建置與部署 (The DevOps)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **⚠️ 多 Repo 執行規則：** 分為兩個 Phase：先 BUILD_LIB（lib → Nexus），再 DEPLOY（service → Docker）。**Phase 1 全部成功後才進入 Phase 2**（因為 service 的 Maven build 需要從 Nexus 拉取新版 lib JAR）。
  - **Phase 1（BUILD_LIB）**：按 `buildOrder` 依序執行
  - **Phase 2（DEPLOY）**：按 **`deployOrder`** 依序執行（API 提供端先部署，消費端後部署）
* **前置確認**：若 `implementation_spec.json` 包含 `dbMigration` 或 `propertiesMigration`，確認 Step 13（The Migrator）已成功執行完畢。若 Step 13 未執行或失敗，**禁止啟動任何 Jenkins 建置**。
* **任務：**

  ### Phase 1：Build Libs（`type=lib` 的 repo，按 buildOrder 排序）

  對每個 `type=lib` 的 repo，依序執行：
  1. 調用 BUILD_LIB Jenkins API 觸發建置：
     ```
     Job:       {repo.jenkinsJob}  (例如 build-lib_common-client-vo)
     Parameters:
       Select       = Self
       RevisionType = BRANCH
       Revision     = branch-{IssueID}-autopilot
       REPO_URL     = {repo.jenkinsParams.REPO_URL}
       MAVEN_COMMAND = clean deploy
     ```
  2. 輪詢 Jenkins 建置狀態（間隔 15 秒，超時 10 分鐘）。
  3. 建置成功後，驗證 Nexus 上可查到新版本：
     ```bash
     curl -s "https://nexus.shaun.lab/service/rest/v1/search?name={artifactId}&version={versionChange.to}" \
       | python3 -c "import json,sys; items=json.load(sys.stdin)['items']; print('FOUND' if items else 'NOT_FOUND')"
     ```
  4. ✅ Nexus 驗證通過 → 繼續下一個 lib
  5. ❌ 失敗 → **中止整個流水線**（後續 service 無法編譯），擷取 Console Output，通知 Shaun

  ### Phase 2：Deploy Services（`type=service` 的 repo，按 `deployOrder` 排序）

  **前提：Phase 1 全部成功。**
  **⚠️ 排序依據 `deployOrder`（非 `buildOrder`）**：API 提供端先部署上線，消費端後部署。確保消費端啟動時，其依賴的 REST API 已經可用。

  對每個 `type=service` 的 repo，依 `deployOrder` 依序執行：
  1. 調用 DEPLOY Jenkins API 觸發部署：
     ```
     Job:       {repo.jenkinsJob}  (例如 AI_WERP_DEV_BOT_DEPLOY_tech-issue-pom(web+rest)(ai_lab))
     Parameters:
       Select       = Self
       RevisionType = BRANCH
       Revision     = branch-{IssueID}-autopilot
       Env          = 192.168.250.200
     ```
  2. 輪詢 Jenkins 建置狀態（間隔 15 秒，超時 10 分鐘）。
  3. 部署成功後，SSH 至 server-200 驗證：
     - WAR 檔案時間戳已更新
     - Docker 容器正常運行（`docker ps`）
     - 服務可回應 HTTP 請求
  4. ✅ 驗證通過 → 繼續下一個 service
  5. ❌ 失敗 → 擷取 Console Output 關鍵錯誤，通知 Shaun

  ### 建置結果記錄

  每個 repo 的建置結果記錄至 `workflow_state.json`：
  ```json
  {
    "repos": [
      {
        "project": "common-client-vo",
        "buildResult": {
          "jenkinsJob": "build-lib_common-client-vo",
          "buildNumber": 5,
          "result": "SUCCESS",
          "nexusVerified": true,
          "timestamp": "2026-04-09T10:30:00Z"
        }
      },
      {
        "project": "tech-issue-pom",
        "buildResult": {
          "jenkinsJob": "AI_WERP_DEV_BOT_DEPLOY_tech-issue-pom(web+rest)(ai_lab)",
          "buildNumber": 15,
          "result": "SUCCESS",
          "warTimestamp": "2026-04-09 18:35",
          "containerStatus": "Up 2 minutes",
          "timestamp": "2026-04-09T10:35:00Z"
        }
      }
    ]
  }
  ```

* **失敗處理：**
  - **Lib 建置失敗**：中止整個流水線（後續所有 service 都無法編譯），通知 Shaun 附上 Console Output
  - **Service 部署失敗**：中止流水線，通知 Shaun，建議回滾方式（lib 不需回滾，service 重新部署 testing 分支）
  - **Nexus 驗證失敗**：lib 建置 SUCCESS 但 Nexus 上找不到新版本 → 中止流水線，可能是 Maven deploy 階段異常

---

## Step 15：部署後驗證 (Smoke Test + Functional Test)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：** 針對部署結果執行基本可用性驗證，並依據 `implementation_spec.json` 中的 `testPlan` 執行功能驗證。
* **⚠️ 多 Repo 注意：** Smoke Test（Phase 2）需對**所有 `type=service` 的已部署服務**執行容器穩定性 + 日誌檢查。`type=lib` 的 repo 不需要 Smoke Test（lib 沒有獨立運行的容器）。
* **輸入：** `autopilot/{IssueID}/implementation_spec.json`（讀取 `testPlan` 區塊）

  ### Phase 1：測試數據準備 (Setup)

  **觸發條件：** `testPlan.setupData` 存在時執行。
  1. 將 `setupData.statements` 寫入 `autopilot/{IssueID}/test_setup.sql`。
  2. 將 `test_setup.sql` SCP 至 server-200 `/tmp/test_setup_{IssueID}.sql`。
  3. 執行 setup SQL：
     ```bash
     ssh -i ~/.ssh/id_ed25519 root@192.168.250.200
     mysql -u {user} -p'{password}' -P {port} {database} < /tmp/test_setup_{IssueID}.sql
     ```
  4. 驗證 setup 成功（SELECT 確認測試數據已存在）。
  5. **失敗處理：** setup SQL 執行失敗 → 記錄錯誤，跳過 Phase 3 的功能測試（Smoke Test 仍繼續執行），在測試報告中標註 `Setup Failed`。

  ### Phase 2：Smoke Test（基本可用性驗證）

  1. **HTTP 回應**：目標服務 URL 回傳 HTTP 200。
  2. **頁面可訪問**：關鍵頁面可正常載入（無 500/404 錯誤）。
  3. **容器穩定性**：部署後 60 秒內容器未重啟（`docker ps` 確認 Up time）。
  4. **應用日誌深度檢查**：檢查容器日誌最後 200 行（`docker logs --tail=200`），搜尋以下關鍵字：
     - `Unknown column`（SQL 欄位錯誤）
     - `SQLGrammarException`（SQL 語法錯誤）
     - `PersistenceException`（JPA 持久化異常）
     - `could not extract ResultSet`（查詢結果集異常）
     - 與本次 Issue ID 相關的 ERROR 日誌
     - 任何匹配即視為 **Smoke Test 失敗**
  5. **失敗處理：** Smoke Test 任一項失敗 → 跳過 Phase 3（功能測試），直接進入 Phase 4 產出報告，通知 Shaun。

  ### Phase 3：Functional Test（基於 Spec 的功能驗證）

  **前提：** Phase 1 Setup 成功 + Phase 2 Smoke Test 通過後才執行。

  依據 `testPlan.testCases` 逐一執行 `category` 為 `api`、`db`、`page` 的自動化測試案例：

  | Category | 執行方式 | 驗證方式 |
  |----------|---------|---------|
  | `api` | `curl` 打 REST API 端點 | 驗 HTTP status code + response body 是否符合 `expectedResult` |
  | `db` | SSH 至 server-200 執行 SQL 查詢 | 驗查詢結果是否符合 `expectedResult` |
  | `page` | `curl` 取得頁面 HTML | 驗 HTTP 200 + HTML 中包含預期的關鍵元素 |
  | `manual` | **不執行** | 彙整至測試報告的「人工確認清單」 |

  **每個測試案例的執行結果記錄：**
  ```
  TC1: ✅ PASS — HTTP 200, response body 包含預期數據
  TC2: ❌ FAIL — HTTP 500, error: NullPointerException (見錯誤詳情)
  TC3: ⏭️ MANUAL — 列入人工確認清單
  ```

  **失敗處理：** 任一自動化測試案例失敗 → 繼續執行剩餘測試案例（收集完整結果），在 Phase 4 報告中標註所有失敗項。

  ### Phase 4：產出測試報告與 Cleanup 腳本

  **1. 測試報告（`autopilot/{IssueID}/test_report.md`）：**
  ```markdown
  # Test Report - {IssueID}
  Generated: {timestamp}

  ## Smoke Test
  - HTTP 回應: ✅ PASS
  - 頁面可訪問: ✅ PASS
  - 容器穩定性: ✅ PASS
  - 日誌檢查: ✅ PASS

  ## Functional Test（自動化）
  | ID | 描述 | 類型 | 結果 | 詳情 |
  |----|------|------|------|------|
  | TC1 | 查詢標籤統計 API | api | ✅ PASS | HTTP 200, count matched |
  | TC2 | 空標籤 edge case | api | ✅ PASS | HTTP 200, empty array |
  | TC3 | 大量資料分頁查詢 | db | ❌ FAIL | Expected 10 rows, got 0 |

  ## ⚠️ 需人工確認項目
  ☐ TC4: 頁面上標籤統計區塊顯示正確數字
     → 步驟：開啟 tech-issue 編輯頁面 → 點擊「標籤統計」Tab
     → 預期：統計表格顯示 tag 名稱與對應數量
  ☐ TC5: 統計表格的排序功能是否正常
     → 步驟：點擊表格欄位標題進行排序
     → 預期：數據依點擊欄位正確排序

  ## 測試數據
  - Setup SQL 已執行：✅
  - Cleanup 腳本：autopilot/{IssueID}/test_cleanup.sh（手動執行）
  ```

  **2. Cleanup 腳本（`autopilot/{IssueID}/test_cleanup.sh`）：**

  根據 `testPlan.cleanupSQL` 產出可手動執行的清理腳本：
  ```bash
  #!/bin/bash
  # Test Data Cleanup - {IssueID}
  # Generated by AUTOPILOT Step 15
  # ⚠️ 手動執行：確認不再需要測試數據後再執行
  #
  # Usage: bash test_cleanup.sh

  SSH_KEY="/home/node/.ssh/id_ed25519"
  HOST="root@192.168.250.200"

  echo "=== Cleaning up test data for {IssueID} ==="
  echo "Target DB: {database} (port {port})"
  read -p "確認要清除測試數據？(y/N) " confirm
  [[ "$confirm" != "y" ]] && echo "Cancelled." && exit 0

  ssh -i $SSH_KEY $HOST <<'EOF'
  mysql -u {user} -p'{password}' -P {port} {database} <<SQL
  -- Cleanup statements from testPlan
  {cleanupSQL statements}
  SQL
  EOF

  echo "=== Cleanup complete ==="
  ```
  - 腳本包含確認提示，防止誤觸
  - 每筆 cleanup SQL 標註對應的 test case ID
  - **不自動執行**，由 Shaun 決定何時清理

* **最終判定：**
  - Smoke Test 全部通過 + Functional Test 全部通過（或無自動化案例）→ **Step 15 PASS**，進入 Step 16
  - Smoke Test 失敗 → **Step 15 FAIL**，通知 Shaun，附上失敗項目與錯誤訊息，建議回滾
  - Functional Test 有失敗項 → **Step 15 PARTIAL**，通知 Shaun，附上完整測試報告，由 Shaun 決定是否繼續或回退修正
* **輸出：**
  - `autopilot/{IssueID}/test_report.md`（完整測試報告）
  - `autopilot/{IssueID}/test_cleanup.sh`（手動清理腳本）
  - `autopilot/{IssueID}/test_setup.sql`（已執行的 setup SQL，供參考）

---

## Step 16：環境清單建立 (The Scribe)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **任務：** 在 Confluence 上為**每個 repo** 建立環境清單頁面，並與 Jira Issue 建立雙向連結。
* **前置條件：** Step 15（Smoke Test）通過後執行。
* **⚠️ 多 Repo 執行規則：** 對 `workflow_state.json` 中 `repos[]` 的**每個 repo 各開一份**環境清單，並在各清單之間建立「關聯清單」互連。
* **步驟：**

  ### A. 建立 Confluence 環境清單頁面（per-repo）

  對每個 repo 執行：
  1. 取得模板：透過 Confluence REST API 取得環境確認清單複製範本（pageId: `38539039`）的 Storage Format HTML。
     - API：`GET /rest/api/content/38539039?expand=body.storage`
  2. 確認父頁面：找到目標專案的環境清單父頁面（例如 `WERP 專案-環境確認清單 tech-issue`），如果找不到父頁面可以先以此連結作為父頁面 http://confluence.shaun.lab:8090/pages/viewpage.action?pageId=35820021 。
  3. 建立新頁面：
     - 標題：`{scm-name} version {version}`（版本號用 Issue ID 代替，如 `QOP-5878`）
     - Space Key：`0BWER1`
     - 父頁面：專案對應的環境清單父頁面
  4. 使用 `POST /rest/api/content` 建立頁面。
  5. **開立原則**：
     - 一般專案的 SCM 原始碼同時包含 web 與 rest，開立一份環境清單即可
     - 若 SCM 原始碼是 web/rest 分開的專案，則需各別開立環境清單
     - **多 Repo 時每個 repo 各開一份**（包含 lib 類型的 repo）

  ### B. 欄位填寫規範

  #### B1. 自動填寫欄位
  以下欄位由 Sub-agent 根據流水線產出物自動填入：

  | 欄位 | 值來源 | 說明 |
  |------|--------|------|
  | jira | `http://jira.shaun.lab:8080/browse/{IssueID}` | Jira Issue 連結 |
  | scm-name | 該 repo 的專案名稱 | SCM 專案名稱 |
  | scm-branch | `testing → branch-{IssueID}-autopilot` | 分支結構 |
  | changeset | `hg log` 最新 changeset hash（per-repo） | 提交記錄 |
  | version | Jira Issue 內容提取，未提供時用 IssueID；**lib 類型額外標註 SNAPSHOT 版號** | 版本號 |
  | 關聯清單 | 同 Issue 的其他 repo 環境清單頁面連結 | **多 Repo 時必填** |
  | 部署順序 | `implementation_spec.json` 中的 `buildOrder` | **多 Repo 時必填**，例如「先部署本 lib，再部署 tech-issue-pom」 |
  | werp lib use | 消費端 service 的環境清單填入：`{lib-name} {version-SNAPSHOT}` | 標註依賴的 SNAPSHOT lib |
  | werp lib support | lib 的環境清單填入：本專案提供的 lib 名稱 | 標註提供的 lib |
  | properties | `autopilot/{IssueID}/migration_properties.md`（Step 13 產出） | 僅當 Step 13 有執行時，在對應 service 的環境清單中填入，格式見 B3 |
  | db-schema 部署前執行 | `autopilot/{IssueID}/migration.sql`（Step 13 產出） | 僅當 Step 13 有執行時，在對應 service 的環境清單中填入，格式見 B2 |
  | db-schema 部署後執行 | `implementation_spec.json` 中定義的部署後 SQL | 僅當 spec 有定義時填入，格式見 B2 |

  #### B1.5 UAT 後版號調整提醒（`type=lib` 的 repo 專用）
  在 lib 的環境清單中，**UAT pass** 欄位附近加入醒目提醒：
  ```
  ⚠️ UAT 通過後需執行：
  1. 將 pom.xml 版號從 {A.B.C-SNAPSHOT} 改為 {A.B.C}（移除 -SNAPSHOT）
  2. 重新 commit + push
  3. 透過 BUILD_LIB 重新建置 release 版本
  4. 消費端 pom.xml 依賴版號同步更新為 {A.B.C}
  5. 更新 changeset
  ```

  #### B2. db-schema SQL 格式規範
  填入環境清單的 SQL 必須遵循以下格式：
  - 每段 SQL 使用 Confluence `{code}` macro 包裹
  - code block 的 title 格式：`{IssueID} ({公司ID列表})`，例如 `QOP-5878 (CY、HT、GF、LR)`
  - SQL 行首加 `use \`{database}\`;`
  - 每行 SQL 語句加 database 前綴
  - 明確區分「部署前執行」和「部署後執行」
  - 新增 table 或變更 schema 時，各公司 database 結構需保持一致性
  - Rollback SQL 同樣填入，格式相同，標題加 `[Rollback]` 前綴

  #### B3. properties 格式規範
  - 每個 properties 檔案獨立一個 Confluence `{code}` macro
  - code block 的 title 為檔案名稱（例如 `tech-issue.properties`）
  - 內容格式範例：
    ```
    [ADD] some.config.key = new-value  (用途說明)
    [MOD] other.key: old-value → new-value
    [DEL] deprecated.key (原值: old-value)
    ```

  #### B4. 留空欄位（人工後續填寫）
  以下欄位由 Sub-agent 保留範本原始結構，不填入任何值：
  - prod date、UAT pass
  - sp部屬步驟
  - abovee-bpm（核決權限表、簽核樣板）
  - 檔案目錄權限開啟、首頁資訊、專案代碼
  - 排程資訊、反向代理設定
  - 更新公司（checkbox 表格）
  - 環境建置清單（ENV 表格）
  - WERP 選單和角色設定、Test Report

  ### C. 建立 Jira ↔ Confluence 雙向連結
  1. **Confluence → Jira**：環境清單頁面的 `jira` 欄位已在 B1 自動填入。
  2. **Jira → Confluence**：在 Jira Issue 新增 Comment，附上 Confluence 環境清單頁面連結。

* **輸出：**
  - Confluence 頁面 URL（已建立並填入 Jira 連結）
  - Jira Comment ID（已附上 Confluence 連結）
  - 環境清單中的 SQL 異動、Properties 異動、Rollback SQL 欄位（當 Step 13 有執行時）
* **失敗處理：**
  - Confluence API 權限不足（403）→ 通知 Shaun 開放 `ai-werp-dev-bot` 在目標 Space 的 Create + Edit 權限。
  - 頁面建立失敗 → 記錄錯誤，不阻擋後續 Step 17（環境清單為輔助文件，非核心流程）。
* **注意事項：**
  - 上版正式站流程目前仍為手工處理，環境清單為追蹤用途。
  - 使用 Python 腳本處理 JSON/HTML 跳脫，避免 shell 跳脫問題。

---

## Step 17：驗收回報 (The Reporter)

* **模型：** `vertex-claude-haiku-4-5` (New Session)
* **輸入：** `autopilot/{IssueID}/test_report.md`（Step 15 產出）+ `workflow_state.json`（所有 repo 建置結果）
* **任務：**
  1. 根據需求文件進行邏輯推理驗證（需求 vs 實作比對）。
  2. 在 Jira Issue **新增 Comment**，標題為 `[Step 17] Deployment Summary`，內容包含：
     - 部署完成時間
     - **涉及 Repo 清單**（列出所有 repo + 類型 + buildOrder + 建置結果）
     - 修改範圍（**per-repo 檔案清單**）
     - **測試結果摘要**：
       - Smoke Test 結果（PASS/FAIL）
       - Functional Test 自動化結果（逐條列出 ✅/❌）
       - **⚠️ 需人工確認項目**（醒目格式，逐條列出步驟與預期結果，供 Shaun 逐一確認）
     - **完整開發軌跡彙總**：匯整所有步驟的 Jira Comment 連結（從 `workflow_state.json` 的 `jiraComments` 讀取），形成完整的開發記錄索引
     - 標註任何上傳失敗的步驟
     - Cleanup 腳本位置提示（`autopilot/{IssueID}/test_cleanup.sh`）
  3. 將 Comment ID 記錄至 `workflow_state.json` 的 `jiraComments.step17_summary`。
* **Jira Comment 測試區塊格式範例：**
  ```
  h3. 自動化測試結果
  || ID || 描述 || 類型 || 結果 ||
  | TC1 | 查詢標籤統計 API | api | (/) PASS |
  | TC2 | 空標籤 edge case | api | (/) PASS |
  | TC3 | 大量資料分頁查詢 | db | (x) FAIL — Expected 10 rows, got 0 |

  h3. {color:red}⚠️ 需人工確認項目{color}
  # *TC4: 頁面上標籤統計區塊顯示正確數字*
  ** 步驟：開啟 tech-issue 編輯頁面 → 點擊「標籤統計」Tab
  ** 預期：統計表格顯示 tag 名稱與對應數量
  # *TC5: 統計表格的排序功能是否正常*
  ** 步驟：點擊表格欄位標題進行排序
  ** 預期：數據依點擊欄位正確排序
  ```
* **回報限制：** 僅新增 Comment，**不可更改 Issue 狀態**（狀態由人工決定）。

---

## ⚠️ 運作機制要求 (Operational Requirements)

### 1. State Persistence（狀態持久化）
- 每個步驟完成後，主 Session 必須將進度更新至 `autopilot/{IssueID}/workflow_state.json`。
- 記錄格式：
  ```json
  {
    "issueId": "QOP-XXXX",
    "currentStep": 5,
    "stepName": "The Architect",
    "status": "in_progress",
    "startedAt": "2026-03-10T06:30:00Z",
    "updatedAt": "2026-03-10T06:35:00Z",
    "crIterations": 0,
    "repos": [
      {
        "project": "tech-issue-client",
        "type": "lib",
        "role": "dependency",
        "buildOrder": 1,
        "deployOrder": null,
        "jenkinsJob": "build-lib_tech-issue-client",
        "versionChange": {"from": "1.5.0-SNAPSHOT", "to": "1.6.0-SNAPSHOT"},
        "steps": {
          "step2_fetched": true,
          "step3_framework": true,
          "step5_schema": false,
          "step9_developed": false,
          "step10_committed": false,
          "step14_built": false
        },
        "buildResult": null
      },
      {
        "project": "tech-issue-pom",
        "type": "service",
        "role": "provider",
        "buildOrder": 2,
        "deployOrder": 1,
        "jenkinsJob": "AI_WERP_DEV_BOT_DEPLOY_tech-issue-pom(web+rest)(ai_lab)",
        "steps": {
          "step2_fetched": true,
          "step3_framework": true,
          "step5_schema": true,
          "step9_developed": false,
          "step10_committed": false,
          "step14_deployed": false
        },
        "buildResult": null
      },
      {
        "project": "portal-pom",
        "type": "service",
        "role": "primary",
        "buildOrder": 3,
        "deployOrder": 2,
        "jenkinsJob": "AI_WERP_DEV_BOT_DEPLOY_portal-pom(web)(ai_lab)",
        "steps": {
          "step2_fetched": true,
          "step3_framework": true,
          "step5_schema": true,
          "step9_developed": false,
          "step10_committed": false,
          "step14_deployed": false
        },
        "buildResult": null
      }
    ],
    "artifacts": {
      "jira_requirement": "autopilot/QOP-XXXX/jira_requirement.md",
      "impact_matrix": "autopilot/QOP-XXXX/impact_matrix.json",
      "db_schema_snapshot": "autopilot/QOP-XXXX/db_schema_snapshot.md",
      "implementation_spec": "autopilot/QOP-XXXX/implementation_spec.json",
      "cr_result": "autopilot/QOP-XXXX/cr_result.md",
      "migration_sql": "autopilot/QOP-XXXX/migration.sql",
      "migration_properties": "autopilot/QOP-XXXX/migration_properties.md",
      "rollback_sql": "autopilot/QOP-XXXX/rollback.sql",
      "rollback_properties": "autopilot/QOP-XXXX/rollback_properties.md",
      "rollback_guide": "autopilot/QOP-XXXX/rollback_guide.md",
      "backup_dir": "autopilot/QOP-XXXX/backup/",
      "test_setup": "autopilot/QOP-XXXX/test_setup.sql",
      "test_report": "autopilot/QOP-XXXX/test_report.md",
      "test_cleanup": "autopilot/QOP-XXXX/test_cleanup.sh"
    },
    "jiraComments": {
      "step3_dependency": null,
      "step5_schema": null,
      "step7_spec": null,
      "step11_cr": null,
      "step13_migration": null,
      "step16_confluence": [],
      "step17_summary": null
    },
    "confluencePages": [],
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
  - ❌ 部署後驗證失敗（Smoke Test 或 Functional Test）
  - ✅ 全流程完成（附部署摘要）
  - ⛔ 流水線中止（附原因與當前步驟）
- **非關鍵步驟正常完成時不推送通知**，避免訊息轟炸。

### 5. Jira Comment 開發軌跡記錄

流水線透過以下步驟自動上傳產出物至 Jira Issue Comment，建立完整的開發軌跡：

| 步驟 | Comment 標題 | 上傳內容 | 上傳方式 |
|------|-------------|---------|---------|
| Step 4（The Recorder） | `[Step 3] Dependency Versions` | 核心框架表格 + 完整依賴清單 | Comment Body（核心）+ 檔案附件（全量） |
| Step 6（The Recorder） | `[Step 5] Schema Snapshot` | `db_schema_snapshot.md` 完整內容 | Comment Body |
| Step 8（The Recorder） | `[Step 7] Implementation Spec (Approved)` | `implementation_spec.json` 完整內容 | Comment Body |
| Step 12（The Recorder） | `[Step 11] CR Passed` 或 `[Step 11] CR Failed (Iteration N)` | CR 審計結果摘要 | Comment Body |
| Step 13（The Migrator） | `[Step 13] Migration Executed` | `migration.sql` + `rollback.sql` + Properties 變更 + 驗證結果 | Comment Body |
| Step 17（The Reporter） | `[Step 17] Deployment Summary` | 部署摘要 + 修改範圍 + 測試結果（自動化 + ⚠️ 人工確認清單）+ 所有步驟 Comment 索引 | Comment Body |

**上傳職責分離原則：**
- Step 4、6、8、12（The Recorder）：獨立的 haiku Sub-agent，專責上傳前一步驟的高成本模型（sonnet/opus）產出物，避免佔用高成本模型的 Session。
- Step 13、17（本身使用 haiku）：上傳工作包含在步驟 Sub-agent 內，無需額外 spawn。

### 6. 驗收失敗回退機制（Post-Deployment Fix）

當 Step 17（Reporter）完成後，人工驗收發現功能異常時，依以下流程回退修正：

**回退路徑：**
```
驗收失敗
    ↓
(0) 判斷失敗類型：
    ├── A. 純程式碼邏輯問題（不涉及 DB/Properties 變更）→ 從 (2) 開始
    ├── B. 需要調整 DB Schema 或 Properties → 從 (1) 開始
    └── C. 需要完全回滾（功能方向錯誤）→ 走「人工回滾 SOP」（Section 7 Rollback 指引）
    ↓
(1) 判斷是否需要額外 migration
    ├── 需要新的 DB/Properties 變更 → 更新 spec 的 dbMigration/propertiesMigration → Step 13（The Migrator）
    └── 需要回滾已執行的 migration → 走人工回滾 SOP，再重新開始
    ↓
(2) 判斷是否有 db_schema_snapshot.md
    ├── 沒有 → 先補跑 Step 5（Schema Collector）+ Step 6（上傳）
    └── 有 → 直接進入 Step 9
    ↓
(3) Step 9（Developer）— 根據錯誤日誌 + schema 快照修正程式碼
    ↓
(4) Step 10（Committer）— 重新 commit + push
    ↓
(5) Step 11（Inspector CR）— 重新審計（含 Schema 雙重驗證 + 框架版本相容性）
    ↓
(6) Step 12（Recorder）— 上傳 CR 結果
    ↓
(7) Step 13（Migrator）— 若 spec 有新增/修改 migration，重新執行（含備份 + 上傳）
    ↓
(8) Step 14（DevOps）— 重新部署
    ↓
(9) Step 15（Smoke Test + Functional Test）— 重新驗證（含日誌深度檢查 + 功能測試）
    ↓
(10) Step 16（Scribe）— 更新 Confluence 環境清單（累加新的 SQL/Properties 異動）
    ↓
(11) Step 17（Reporter）— 更新 Jira Comment（記錄修復內容）
```

**注意事項：**
- **不可跳過 Step 10-11**：修正後的代碼必須重新推送 SCM 並通過 CR。
- **Step 9 修正時的輸入**：除了 `implementation_spec.json`，還需提供驗收失敗的錯誤日誌（異常堆棧）作為修正依據。
- **修復迭代上限**：與 CR 相同，最多 3 次。超過 3 次仍未通過驗收，中止流水線並通知 Shaun 人工介入。
- **Jira Comment 更新**：Step 17 應在原有 Comment 基礎上追加修復記錄，而非覆蓋。
- **Confluence 更新**：Step 16 在修復迭代中應**累加**新的 SQL/Properties 異動記錄，而非覆蓋。環境清單需完整反映所有變更歷程。
- **Migration 累加原則**：若修復涉及新的 DB 變更（例如第一次加了欄位，修復時又改了欄位型別），`migration.sql` 和 `rollback.sql` 必須累加更新，rollback 要能從最終狀態一路還原回最初狀態。

---

### 7. Rollback 指引（三層回滾 SOP）

回滾涉及三個層面：**DB Schema → Properties → 程式碼**。流水線負責**自動產出所有回滾資料**，但**回滾執行為人工決策**，不自動執行。

#### 回滾資料自動產出（Step 13 責任）
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
Step 3: 程式碼回滾（多 Repo 時按反向 buildOrder 執行）
    ↓ 對每個 type=service 的 repo：透過 Jenkins 重新部署 testing 分支
    ↓ (RevisionType=BRANCH, Revision=testing)
    ↓ ⚠️ Lib 類型的 repo 不需要回滾部署（Nexus 上的舊版本仍存在，
    ↓   消費端重新部署 testing 分支時會自動拉取原始版本）
    ↓
Step 4: 容器重啟與驗證
    ↓ docker restart {service}（對每個 service）
    ↓ 確認 WAR 時間戳、容器正常、HTTP 200
```

**⚠️ 順序很重要**：必須**先還原 DB/Properties，再回滾程式碼**。若先回滾程式碼，舊版程式可能無法相容新的 DB Schema，導致啟動失敗。

**⚠️ 多 Repo 回滾注意**：Service 回滾到 testing 分支後，其 `pom.xml` 中的依賴版本會回到原始值（如 `2.1.0-SNAPSHOT`），Maven build 會自動從 Nexus 拉取對應的舊版 lib JAR。因此 **lib 通常不需要主動回滾**，除非 lib 的 SNAPSHOT 版號與正式站衝突。

#### Confluence 環境清單的角色
- Step 16 已將 `migration.sql`、`rollback.sql`、Properties 異動寫入 Confluence 環境清單。
- 上版正式站時，維運人員可直接從環境清單取得所有回滾指令，無需存取開發環境的 autopilot 目錄。
- **多 Repo 時**，每個 repo 的環境清單都透過「關聯清單」互連，維運人員可從任一清單找到所有相關清單。

#### 注意事項
- **資料遺失風險**：若 migration 新增了欄位且已有業務資料寫入，DROP COLUMN 會導致資料遺失。此情況需 Shaun 判斷是否接受。
- **備份是最終防線**：`pre_migration_schema.sql` 保留了變更前的完整 Schema，可用 `mysqldump --no-data` 的輸出進行比對或極端情況下的還原。
- **Properties 備份有時間戳**：備份目錄名包含 Issue ID + 時間戳，可精確對應到哪次變更的備份。
- **Nexus SNAPSHOT 覆蓋**：SNAPSHOT 版本在 Nexus 中是可覆蓋的，所以新版 lib 會覆蓋同版號的舊 SNAPSHOT。若需要完全回滾 lib，需檢查 Nexus 上是否還有舊版。

---

**最後更新：** 2026-04-09（Multi-Repo Pipeline：Impact Discovery + 反向 Service 推薦 + buildOrder/deployOrder 分離 + BUILD_LIB Phase + Cross-Service API 合約驗證 + 多環境清單 + Lib 版號管理）
**維護者：** AI Dev Bot 🦞
