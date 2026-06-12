# 📌 MySQL / MariaDB 指令範本分類
 
## 1. 檢測安裝與狀態
```
-- 顯示目前安裝的引擎  
SHOW ENGINES;
 
-- 顯示目前安裝的插件  
SHOW PLUGINS;
 
-- 顯示所有使用者  
USE mysql;  
SELECT CONCAT("'", user, "'@'", host, "'") FROM user;  
  
-- 顯示指定使用者的權限  
SHOW GRANTS FOR 'username'@'host';  
  
-- 顯示 general log 設定  
SHOW VARIABLES LIKE "%general%log%";  
  
-- 開啟 general log  
SET GLOBAL general_log = 1;  
SET GLOBAL general_log_file = 'general-YYYYMMDD.log';  
```
  
## 2. 備份與還原  
  
```
### 2.1 備份所有資料庫  
mysqldump -u root -p{password} --all-databases > all_db_backup.sql  
  
# 備份特定資料庫  
mysqldump -u root -p{password} db_name > db_backup.sql  
  
# 備份多張資料表  
mysqldump -u root -p{password} database_name table1 table2 > backup.sql  
  
# 遠端備份  
mysqldump -h {host} -u {user} -p{passwd} db_name > backup.sql  
  
### 2.2 還原  
# 還原單一資料庫  
mysql -u root -p{password} db_name < backup.sql  
  
# 還原多個資料庫  
mysql -u root -p{password} < backup.sql  
```
  
## 3. 使用者與權限管理  

```
# 建立使用者 & 給予權限  
-- 全庫權限  
GRANT ALL PRIVILEGES ON *.* TO 'username'@'%' IDENTIFIED BY 'password' WITH GRANT OPTION;  
  
-- 指定資料庫全權限  
GRANT ALL PRIVILEGES ON `database_name`.* TO 'username'@'host' IDENTIFIED BY 'password' WITH GRANT OPTION;
-- 密碼直接設定為 BASE64
GRANT ALL PRIVILEGES ON `database_name`.* TO 'username'@'host' IDENTIFIED BY PASSWORD '*8F2B6E79FCEBFB5482D1F81276D05E1512DA6D0C';
  
-- 指定資料庫只讀  
GRANT SELECT, LOCK TABLES ON `database_name`.* TO 'username'@'host' WITH GRANT OPTION;  
  
FLUSH PRIVILEGES;  
  
### 3.2 移除權限  
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'username'@'host';  
FLUSH PRIVILEGES;  
```  
  
## 4. 資料表操作  
```
-- 複製表結構與資料  
CREATE TABLE new_table LIKE old_table;  
INSERT INTO new_table SELECT * FROM old_table;  
  
-- 查詢欄位編碼  
SHOW FULL COLUMNS FROM `db_name`.`table_name`;  
  
-- 更新資料  
UPDATE `db_name`.`table_name` SET column = 'value' WHERE condition;  
  
-- 批次更新 (replace)  
UPDATE table_name SET column = REPLACE(column, 'old_text', 'new_text') WHERE column LIKE '%old_text%';  
```
  
## 5. 安裝 / 移除插件  
-- 安裝 FEDERATED (MariaDB)  
```
INSTALL PLUGIN federated SONAME 'ha_federated.so';  
INSTALL PLUGIN federated SONAME 'ha_federatedx.so';  
  
-- 移除插件  
UNINSTALL PLUGIN FEDERATED;
```
  
## 6. 設定調整  
# my.cnf / my.ini 設定  
max_allowed_packet=160M  
  
  
## 7. 排程事件 (EVENT)  
```
CREATE DEFINER=`user`@`%` EVENT `event_name`  
ON SCHEDULE EVERY 1 MINUTE STARTS CURRENT_TIMESTAMP  
ON COMPLETION NOT PRESERVE  
DO   
    -- 任務內容  
    DELETE FROM table_name WHERE create_time < DATE_SUB(NOW(), INTERVAL 1 DAY);  
  
-- 啟用事件排程器  
SET GLOBAL event_scheduler = 1;  
  
-- 刪除事件  
DELETE FROM mysql.event WHERE name = 'event_name';  
```  
  
## 8. MySQL binlog 查看  
```
# 直接轉成可讀檔案  
mysqlbinlog mysql-bin.000012 > mysql-bin.000012.log  

# 依時間範圍過濾
mysqlbinlog --start-date="YYYY-MM-DD HH:MM:SS" --stop-date="YYYY-MM-DD HH:MM:SS" /var/lib/mysql/mysql-bin.000012 > /tmp/output.sql
```

### 9. Replication 抄寫失敗
```
# 先執行以下指令查看錯誤訊息為何
SHOW SLAVE STATUS

# 如果只是重開機後未喚醒同步抄寫時，執行以下指令喚醒抄寫作業
START SLAVE;

# 如果是抄寫過程時發生異常則需仔細查看 Last Error 為何，如果是結構問題導致資料寫入異常則 skip 該筆寫入動作，然後再觀察是否持續發生異常，再用同樣方式處理 | 多數情況下都是因為結構問題導致寫入失敗，當恢復抄寫時應回頭修正 master 結構性問題，避免 repl 主機寫入的內容不正確
STOP SLAVE;
-- 跳過這一個引發錯誤的事件
SET GLOBAL sql_slave_skip_counter = 1; 
START SLAVE;
SHOW SLAVE STATUS
```
