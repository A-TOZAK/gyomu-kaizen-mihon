/**
 * 案件管理 — GAS Webアプリ（スプレッドシート「案件管理」に付けるスクリプト）
 * v0.5（2026-10-24）。画面は v0.4 のまま、担当を選びやすくし、手引き・お金（見積と請求）・カレンダーを足した（本人「ガラッと変えなくていい」）。v0.4 は _v0.4/ に控えがある。
 * 見本 v0.3（2026-10-01）。段階を実際の仕事の順の7つにした（本人の声）。v0.2 は _v0.2/ に控えがある。
 * 見本 v0.2（2026-09-28 深夜）。架空の3件で試す段階。
 *
 * 作り
 *   人の画面：Index.html ⇄ google.script.run ⇄ このファイル ⇄ スプレッドシート（5枚）
 *   Claude Code：okuri.py ─ POST（合言葉つきJSON）→ doPost ⇄ スプレッドシートとドライブ。人の目で確認の段階に入ったらメール
 *
 * 置き方は README.md のとおり。デプロイは2本に分ける。
 *   画面用　　：次のユーザーとして実行「自分」、アクセスできるユーザー「自分のみ」
 *   受け口用　：次のユーザーとして実行「自分」、アクセスできるユーザー「全員」（合言葉で守る。画面は出さない）
 *
 * スクリプトのプロパティ
 *   TOKEN      合言葉（okuri.py init が作ってクリップボードに写す）。必須
 *   APP_URL    画面用のURL（通知メールに書く）
 *   NOTIFY_TO  通知の宛先（空なら、このスクリプトの持ち主）
 *   MEMBERS    画面を使える人のメール（カンマ区切り。持ち主は書かなくても入る）
 *   NAMES      メールと呼び名の対応（例 {"demo@example.com":"木村"}）。記録や「済にした人」を名前で出す
 *
 * 試験：test/run.js が、このファイルをそのまま偽のGoogle（test/fake-gas.js）の上で動かす。
 */

const TZ = 'Asia/Tokyo';
/** 表のスプレッドシートのID。空なら、このスクリプトが付いているスプレッドシートを使う */
const SPREADSHEET_ID = '';   // 見本の表

const SHEETS = {
  '案件': ['案件番号', '受付日', '区分', '紹介元', '依頼者の担当', '建築主', '所在地番', '自治体', '主担当',
          '段階', '保留', '期日', '着工予定', '追加手続の候補', '人の確認（残り）',
          'フォルダ', '報告書', '確認用リンク集', 'メモ', '更新日時',
          '照合の済', '現地写真',   // v0.3 で足した列は、前からある列の位置を変えないよう最後に置く
          '見積', '請求', '入金', '見積書', '請求書',   // v0.5 お金（2026-10-24 本人「見積書と請求書は中村さんにClaudeで」）
          '役所調査ガイド'],   // 窓口へ持っていく紙のPDF（2026-10-24 本人「役所調査ガイドのリンクもアプリに」。スキル madoguchi-shijisho が置く）
  'やること': ['案件番号', '番号', '分類', 'やること', '担当', '開始日', '終了日', '済', '済んだ日', 'メモ', 'リンク', '足した人'],
  '人の確認': ['案件番号', '番号', '重さ', '確かめること', 'いまの値と理由', 'どこで', '済', '済にした人', '済にした日時', 'メモ'],
  '記録': ['日時', '案件番号', '誰が', 'できごと'],
  '報告書の欄': ['案件番号', '番号', '区分', '欄', '値', '状態', '問い', '出典'],   // 役所調査の報告書の欄と、ネットで済んだか（2026-09-29）
  '標準日数': ['区分', '順', '分類', 'やること', '起点', '日数', 'メモ'],
  // 段階ごとの考え方とポイント（2026-10-24 本人「マニュアル的なものもすぐに確認できるように」）。表で書きかえられる
  '手引き': ['段階', '順', 'ポイント', 'くわしく', 'リンク'],
};

const CHOICES = {
  '区分': ['敷地調査', '許認可', '建物', '確定測量', '土地の登記'],
  // 実際の仕事の順（2026-10-01 本人）。田中さんがメールを受けてChatworkで木村さんへ、木村さんがClaude Codeに渡す
  // 最後は「報告書の納品」（木村がクライアントに送り、田中さんに報告）→「完了」（2026-10-02 本人）
  '段階': ['受付', 'たたき台の作成', '人の目で確認', '窓口で確認', '現地調査', '最終チェック', '報告書の納品', '完了'],
  '担当': ['中村', '木村', '田中', '山口', '松尾', '行政書士法人', 'Claude Code'],   // 「さん」をつけない（2026-09-28）。、松尾さんが加わった（2026-09-30 本人）
  '分類': ['受付', '役所調査', '現地調査', '追加手続', '許認可', '報告と納品', 'その他'],
};

/** 段階ごとの説明（画面に出す） */
const STAGE_NOTE = {
  '受付': '依頼のメールを受けて、Claude Codeに渡す',
  'たたき台の作成': '役所調査の報告書と照合表を作る',
  '人の目で確認': '照合表で根拠を開いて、済を入れる',
  '窓口で確認': '窓口でしか決まらないことを聞く',
  '現地調査': '現地の欄を入れて、写真を置く',
  '最終チェック': '特記事項と報告書の全体を見る',
  '報告書の納品': 'クライアントに送り、田中さんに報告する',
  '完了': '報告まで済んだ',
};

/** 段階ごとの担当の決まり（画面で案件ごとに替えられる）。
 *  2026年11月からは、受付・人の目・窓口・納品とお金の事務を中村さんが受け持つ（2026-10-24 本人「事務的なところや発送は中村さんに。
 *  役所に行くのは中村さん」）。現地と最終チェックは田中さんの事務所のまま */
const STAGE_OWNER = {
  '受付': '田中', 'たたき台の作成': 'Claude Code', '人の目で確認': '木村', '窓口で確認': '木村',
  '現地調査': '田中', '最終チェック': '田中', '報告書の納品': '木村', '完了': '木村',
};
const TAKAHARA_FROM = '2026-11-01';
const TAKAHARA_STAGES = ['受付', '人の目で確認', '窓口で確認', '報告書の納品', '完了'];
function stageOwner_(stage, day) {
  const o = STAGE_OWNER[stage] || '';
  if (TAKAHARA_STAGES.indexOf(stage) >= 0 && (day || today_()) >= TAKAHARA_FROM) return '中村';
  return o;
}
/** 新しい依頼を渡す先（案件の一覧の上に出す） */
function intakeTo_() { return today_() >= TAKAHARA_FROM ? '中村' : '木村'; }
function stageOwners_() {
  const o = {};
  CHOICES['段階'].forEach(s => { o[s] = stageOwner_(s); });
  return o;
}

/** v0.2 までの段階の名前を、v0.3 の名前に読みかえる */
const STAGE_OLD = { '調査': 'たたき台の作成', '人の確認': '人の目で確認', '窓口確認': '窓口で確認', '納品済み': '完了' };
function stageFix_(v) { return STAGE_OLD[v] || v; }

/** 段階ごとの「やること」の行（2026-10-02 本人「いまのやることが現地調査なのに、右は人の目で確認。よくわからない」）。
 *  やることの行は段階と同じ名前にし、いまのやることは今の段階から出す。日付は受付日からの日数の目安で、人が画面で直せる */
const STAGE_PLAN = [
  // [段階, 分類, 始まり（受付日から何日後）, 終わり（受付日から何日後）]
  ['受付', '受付', 0, 0],
  ['たたき台の作成', '役所調査', 0, 1],
  ['人の目で確認', '役所調査', 1, 2],
  ['窓口で確認', '役所調査', 2, 4],
  ['現地調査', '現地調査', 5, 5],
  ['最終チェック', '報告と納品', 6, 6],
  ['報告書の納品', '報告と納品', 7, 7],
];
function addDays_(ymd, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
  d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}
function stageName_(v) { return String(v || '').replace(/（[^）]*）$/, '').trim(); }
/** 敷地調査の案件のやることを、段階と同じ7行にそろえる。前の段の行は済、今の段とそれより後は済でない。
 *  人が足した行は残す。段階の行に人が直した日付・担当・メモ・リンクも残す。
 *  道具が前の形（受付・Web調査・現地調査…の7工程）で送った行があるときは、作り直す */
function ensureStageTasks_(id) {
  const row = getCase_(id);
  if (!row || row['区分'] === '許認可') return;
  const st = CHOICES['段階'], cur = st.indexOf(stageFix_(row['段階']));
  const mine = readAll_('やること').filter(r => r['案件番号'] === id);
  const tool = mine.filter(r => r['足した人'] === BY_TOOL);
  const fresh = tool.some(r => st.indexOf(stageName_(r['やること'])) < 0);
  const before = {};
  if (!fresh) tool.forEach(r => { before[stageName_(r['やること'])] = r; });
  const used = {};
  mine.filter(r => r['足した人'] !== BY_TOOL).forEach(r => { used[r['番号']] = true; });
  let next = 1;
  const rows = STAGE_PLAN.map(([s, kind, a, z]) => {
    const p = before[s] || {};
    const start = p['開始日'] || addDays_(row['受付日'], a), end = p['終了日'] || addDays_(row['受付日'], z);
    const done = st.indexOf(s) < cur;
    let no = p['番号'] && !used[p['番号']] ? p['番号'] : '';
    if (!no) { while (used[next]) next++; no = next; }
    used[no] = true;
    return {
      '案件番号': id, '番号': no, '分類': kind, 'やること': s,
      '担当': p['担当'] || stageOwner_(s, start), '開始日': start, '終了日': end,
      '済': done ? 'TRUE' : 'FALSE', '済んだ日': done ? (p['済'] === 'TRUE' && p['済んだ日'] ? p['済んだ日'] : today_()) : '',
      'メモ': p['メモ'] || '', 'リンク': p['リンク'] || '', '足した人': BY_TOOL,
    };
  });
  deleteWhere_('やること', r => r['案件番号'] === id && r['足した人'] === BY_TOOL);
  appendObjs_('やること', rows);
}
/** 前の形のやることを、一度だけ段階の行に入れかえる。済んだら STAGE_TASKS_FIXED に印をつける */
function fixStageTasks_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('STAGE_TASKS_FIXED') === '1') return;
  readAll_('案件').forEach(c => { if (c['区分'] !== '許認可') ensureStageTasks_(c['案件番号']); });
  props.setProperty('STAGE_TASKS_FIXED', '1');
}

/** 人が決める列。Claude Code が送り直しても、人が入れた値があれば上書きしない */
// 「主担当」の列は、画面では「案件担当」（会社側で案件を受け持つ人。既定は木村）と呼ぶ（2026-10-01 本人）
/** 案件担当の既定（2026-10-01 本人「基本的には木村で」） */
const CASE_OWNER = '木村';
const HUMAN_COLS = ['主担当', '保留', '着工予定', 'メモ'];
/** 画面から変えてよい案件の列 */
const EDITABLE = ['受付日', '区分', '紹介元', '依頼者の担当', '建築主', '所在地番', '自治体', '主担当',
                  '段階', '保留', '期日', '着工予定', '追加手続の候補', 'メモ', '見積', '請求', '入金'];
/** 画面から変えてよい「やること」の列 */
const TASK_EDITABLE = ['分類', 'やること', '担当', '開始日', '終了日', '済', 'メモ', 'リンク'];
/** ファイルのリンクを書く列 */
const LINK_COLS = ['報告書', '確認用リンク集', '見積書', '請求書', '役所調査ガイド'];
/** 名前つきカメラ（撮るときに写真に名前を付けるWebのカメラ。2026-10-19 田中さんの声から木村が作った） */
const CAMERA_URL = 'https://a-tozak.github.io/namae-camera/';
/** お金の列（人も画面の「直す」から書ける。Claude が書くときは action jimu） */
const MONEY_COLS = ['見積', '請求', '入金'];
const BY_TOOL = 'Claude Code';

/** 標準日数の仮の値。敷地調査は uketsuke.py の STEPS と同じ。許認可の日数は田中さんに聞いて入れる */
const STD_SEED = [
  ['敷地調査', 1, '受付', '受付（メールをChatworkで渡す）', '受付日', 0, '田中'],
  ['敷地調査', 2, '役所調査', 'たたき台の作成', '受付日', 0, 'Claude Code'],
  ['敷地調査', 3, '役所調査', '人の目で確認（照合表）', '受付日', 1, '木村。11月から中村'],
  ['敷地調査', 4, '役所調査', '窓口で確認', '調査日', 1, '木村。11月から中村'],
  ['敷地調査', 5, '現地調査', '現地調査', '調査日', 0, '田中。調査日がなければ受付日の5日後'],
  ['敷地調査', 6, '報告と納品', '最終チェック', '期日', -1, '田中'],
  ['敷地調査', 7, '報告と納品', '納品', '期日', 0, '田中'],
  ['許認可', 1, '許認可', '事前相談と資料集め', '受任日', '', '日数は田中さんに聞いて入れる'],
  ['許認可', 2, '許認可', '資格者の確認と申請', '', '', '行政書士法人'],
  ['許認可', 3, '許認可', '補正の対応', '', '', ''],
  ['許認可', 4, '報告と納品', '許可と報告', '', '', ''],
];


/** 手引きの最初の中身（表「手引き」が空のときに入れる。あとは表で書きかえる）。
 *  元は 20_業務マニュアル（2026-10-12）と、窓口の指示書・図面のスキル（2026-10-18、10-24） */
const GUIDE_SEED = [
  ['全体', 1, '実案件の情報は外に出しません', '個人の無料のAIに図面や登記を貼りません。ドライブもLINEも個人の物を使いません。窓口には所在と地番で聞きます。'],
  ['全体', 2, 'メールとファイルの送信は、必ず人が押します', 'Claude が作るのは下書きまでです。許認可の要否と申請は見本行政書士法人、境界と測量の判断は田中さんの事務所が決めます。'],
  ['全体', 3, '連絡はChatworkで行います', 'この画面は「いまどこまで進んだか」と「だれがいつ動くか」を見る所です。相談や連絡はChatworkに書きます。'],
  ['受付', 1, 'Chatworkの案件の連絡を開き、添付の資料をすべてダウンロードします', '連絡の文面はコピーして「メール.txt」という名前で保存します。名前に「メール」を入れると道具が読みます。'],
  ['受付', 2, 'メール.txt と添付を「00_受付箱」に入れ、Claude に「新しい依頼」と言います', '案件番号のフォルダと、この画面の案件ができます。受付箱は空に戻ります。'],
  ['受付', 3, '位置図、公図、登記簿謄本がそろっているかを見ます', '足りない物は Claude が一覧にします。登記は田中さんの事務所のアカウントで取ります。'],
  ['受付', 4, '受付の返事は、Claude に「受付の返事を作って」と言います', 'メールの下書きができます。送るのは人です。'],
  ['たたき台の作成', 1, 'ネットで分かることを Claude が集め、報告書と照合表を作ります', '担当した58自治体の32項目のうち、ネットで値まで取れるのは約4割、目安まで取れるのは約3割です。残りは照会、窓口、現地で確かめます。'],
  ['たたき台の作成', 2, '人が見るのは、★の項目と「地番が見込み」の札です', '地番が見込みのときは、公図と登記で確かめるまで報告書の値は仮のものです。'],
  ['たたき台の作成', 3, '取れなかったことと、該当しないことは分けて書きます', '取れなかったのに「該当なし」と書くのが、いちばん起きやすい誤りです。'],
  ['人の目で確認', 1, '照合表を開き、行ごとに根拠のリンクを開いて、値が資料と合っているかを見ます', '照合表は、役所調査の報告書のスプレッドシートの1枚目です。'],
  ['人の目で確認', 2, '合っていれば「済」のチェックを押します', '色が消えて、行が灰色になります。この画面を開くと、済の数を数え直します。'],
  ['人の目で確認', 3, 'Claude が図面から読んだ数字は「読み」です。図面で確かめます', '福岡市と糸島市のWeb地図は古い座標の決まりです。そのまま使うと約420mずれるので、地番で照らします。'],
  ['窓口で確認', 1, '行く人と行く日を、「窓口で聞くこと」の欄で決めます', '決めた人と日はカレンダーに出ます。'],
  ['窓口で確認', 2, '持っていく紙は、Claude に「役所調査ガイドを作って」と言います', '窓口ごとに1枚で、館内の案内図、撮る写真、聞くことが入ります。'],
  ['窓口で確認', 3, '伝えるのは所在と地番までです', '依頼者や所有者の名前は、求められない限り言いません。'],
  ['窓口で確認', 4, '「適用されますか」ではなく「どう案内していますか」と聞きます', '答えた人の係と名字と日時を残します。聞けなかったことも「聞けなかった」と書きます。'],
  ['窓口で確認', 5, '相手の了承を得てから、PLAUD NOTE で録音します', '文字起こしを案件フォルダに入れ、Claude に「窓口の答えを書き足して」と言います。'],
  ['窓口で確認', 7, '写真は「名前つきカメラ」で撮ります', '撮るときに写真に名前を付けられます。窓口と現地の欄にあるボタンから開きます。'],
  ['窓口で確認', 6, 'ガスと埋蔵文化財は、前の日までに照会します', 'ガス会社は地域で違います（西部ガス、筑紫ガス、近くのガス会社など）。その案件の照会先は「窓口で聞くこと」の中に出ます。'],
  ['現地調査', 1, '測量は田中さんの事務所が行い、速報図面をChatworkで送ってくれます', ''],
  ['現地調査', 2, '速報図面は案件フォルダの「添付」に入れ、Claude に「速報図面が届いた」と言います', '実測の面積、現況幅員、境界杭、高低差、電柱を読み、「納品前に確かめる」の印をつけます。'],
  ['現地調査', 3, '現地の写真は「現地写真を入れる」から入れます', '写真帳は写真帳メーカーで作れます。'],
  ['最終チェック', 1, '最終図面が届いたら、Claude に「最終図面が届いた」と言います', '速報図面との差（面積、境界の位置、高さ）を出し、「納品前に確かめる」の印を外します。'],
  ['最終チェック', 2, '特記事項の文は、決まった文から組みます', 'Claude に自由に作文させません。'],
  ['最終チェック', 3, '手で直した所があるときは、道具で回し直しません', '回し直すと手で直した所が消えます。Claude に書き足しを頼みます。'],
  ['報告書の納品', 1, '窓口で聞いたその日のうちに渡すのが目標です', ''],
  ['報告書の納品', 2, '納品のメールは、Claude に「納品のメールを作って」と言います', 'メールの下書きができます。送るのは人です。送ったら、この画面の2つの確認を済にします。'],
  ['報告書の納品', 3, '許認可が要りそうなときは、見本行政書士法人へつなぎます', '要否を決めるのと申請は、資格者が行います。'],
  ['完了', 1, '見積書と請求書は、Claude に「見積書を作って」「請求書を作って」と言います', '書類とメールの下書きができ、この画面の「お金」の欄に入ります。'],
  ['完了', 2, '金額、振込先、登録番号が決まるまでは、書類に「未確定」と出ます', '未確定のまま送りません。決まったら設定のファイルに入れます。'],
  ['完了', 3, '入金を確かめたら、Claude に「入金を確かめた」と言います', '「直す」から入金の欄に日付を書いてもかまいません。'],
];

// ─────────────────────────────────────────────
// 入口
// ─────────────────────────────────────────────

function doGet() {
  if (!isMember_()) {
    return HtmlService.createHtmlOutput(
      '<p style="font-family:sans-serif;padding:24px;line-height:1.8">この画面は、決まった人だけが見られます。</p>')
      .setTitle('案件管理');
  }
  // 最初のデータをページに埋めて返す。画面が開いてから取りに行く往復を1回へらす（2026-09-28）
  const tpl = HtmlService.createTemplateFromFile('Index');
  tpl.bootTag = '<script>window.__BOOT=' + JSON.stringify(getAll()).replace(/</g, '\\u003c') + ';</script>';
  return tpl.evaluate()
    .setTitle('案件管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Claude Code からの受け口。合言葉が合わなければ何もしない */
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'JSONが読めません' });
  }
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || !body || body.token !== token) return json_({ ok: false, error: '合言葉が違います' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.action === 'case') return json_(receiveCase_(body));
    if (body.action === 'file') return json_(receiveFile_(body));
    if (body.action === 'recolor') return json_(recolor_(body));
    if (body.action === 'links') return json_(setLinks_(body));
    if (body.action === 'jimu') return json_(jimu_(body));
    if (body.action === 'peek') return json_({ ok: true, case: getCase_(String(body['案件番号'] || '')) });
    if (body.action === 'remove') return json_(removeCase_(String(body['案件番号'] || ''), BY_TOOL));
    if (body.action === 'ping') return json_({ ok: true, sheets: Object.keys(SHEETS).map(n => sh_(n).getName()) });
    return json_({ ok: false, error: 'action が分かりません：' + body.action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────
// Claude Code から受け取る
// ─────────────────────────────────────────────

/** 案件1件分：{case:{…}, tasks:[…], checks:[…], log:'…'} */
function receiveCase_(b) {
  const c = b.case || {};
  const id = String(c['案件番号'] || '').trim();
  if (!/^[A-Za-z0-9\-_見本]+$/.test(id)) throw new Error('案件番号がないか、使えない文字があります：' + id);
  if (c['段階']) c['段階'] = stageFix_(c['段階']);
  if (c['段階'] && CHOICES['段階'].indexOf(c['段階']) < 0) throw new Error('段階が選択肢にありません：' + c['段階']);
  const old = getCase_(id);
  const row = Object.assign({}, old || {});
  if (c['主担当']) c['主担当'] = nameFix_(c['主担当']);
  Object.keys(c).forEach(k => {
    if (SHEETS['案件'].indexOf(k) < 0) return;
    if (old && HUMAN_COLS.indexOf(k) >= 0 && old[k] && old[k] !== 'FALSE') return;
    // 段階は戻さない。人が進めた段階を、送り直しで前の段に戻さない（2026-10-02）
    if (k === '段階' && old && CHOICES['段階'].indexOf(stageFix_(old['段階'])) > CHOICES['段階'].indexOf(c[k])) return;
    row[k] = c[k];
  });
  row['段階'] = stageFix_(row['段階'] || '受付');
  if (!row['保留']) row['保留'] = 'FALSE';
  if (!row['主担当']) row['主担当'] = CASE_OWNER;
  const folder = caseFolder_(id, row['所在地番']);
  if (!row['フォルダ']) row['フォルダ'] = folder.getUrl();
  if (!row['現地写真']) row['現地写真'] = photoFolder_(folder).getUrl();
  if (b.check) row['照合の済'] = JSON.stringify(b.check);

  // 敷地調査のやることは段階と同じ行にする。道具が送る前の形の工程は使わない（2026-10-02）
  const stageTasks = row['区分'] !== '許認可';
  if (Array.isArray(b.tasks) && !stageTasks) replaceTasks_(id, b.tasks);
  if (Array.isArray(b.checks)) replaceChecks_(id, b.checks);
  if (Array.isArray(b.fields)) replaceFields_(id, b.fields);
  if (row['区分'] !== '許認可') ensureDelivery_(id);
  row['人の確認（残り）'] = remainingLabel_(id);
  row['更新日時'] = now_();
  writeObj_('案件', { '案件番号': id }, row);
  if (stageTasks) ensureStageTasks_(id);
  addLog_(id, BY_TOOL, b.log || (old ? '案件のデータを受け取って書き直した' : '案件を受け付けた'));

  let mailed = false;
  if (row['段階'] === '人の目で確認' && (!old || stageFix_(old['段階']) !== '人の目で確認')) {
    notify_(row);
    mailed = true;
  }
  return { ok: true, '案件番号': id, folder: folder.getUrl(), mailed: mailed };
}


/** Claude（事務）から：お金の欄、納品の確認、事務のやることを書く（2026-10-24 本人「AIで入れていく情報をWebアプリに入れる」）。
 *  {案件番号, money:{見積|請求|入金: 文}, done:[確かめること…], task:{やること, 担当, 済, メモ, リンク, 分類}, log, who}
 *  ファイル（見積書・請求書のPDF）は action file の kind で置く。送信はしない（メールは人が送る） */
const BY_JIMU = 'Claude（事務）';
function jimu_(b) {
  const id = String(b['案件番号'] || '').trim();
  const row = getCase_(id);
  if (!row) throw new Error('案件が見つかりません：' + id);
  const who = String(b.who || BY_JIMU);
  const did = [];
  Object.keys(b.money || {}).forEach(k => {
    if (MONEY_COLS.indexOf(k) < 0) throw new Error('お金の欄にありません：' + k);
    const v = String(b.money[k] == null ? '' : b.money[k]).trim();
    if ((row[k] || '') === v) return;
    row[k] = v;
    did.push(k + 'を「' + (v || '空') + '」にした');
  });
  (b.done || []).forEach(t => {
    const r = findRow_('人の確認', { '案件番号': id, '確かめること': String(t) });
    if (r < 0) { ensureDelivery_(id); }
    const r2 = findRow_('人の確認', { '案件番号': id, '確かめること': String(t) });
    if (r2 < 0) throw new Error('確認の項目が見つかりません：' + t);
    const o = rowObj_('人の確認', r2);
    if (o['済'] === 'TRUE') return;
    o['済'] = 'TRUE'; o['済にした人'] = who; o['済にした日時'] = now_();
    writeRow_('人の確認', r2, o);
    did.push('確認を済にした：' + t);
  });
  if (b.task && String(b.task['やること'] || '').trim()) {
    const t = b.task, name = String(t['やること']).trim();
    const r = findRow_('やること', { '案件番号': id, 'やること': name });
    const o = r > 0 ? rowObj_('やること', r) : { '案件番号': id, 'やること': name, '足した人': BY_JIMU, '分類': 'その他', '済': 'FALSE' };
    TASK_EDITABLE.forEach(k => { if (t[k] !== undefined && t[k] !== null) o[k] = String(t[k]); });
    if (o['担当']) o['担当'] = nameFix_(o['担当']);
    o['済'] = bool_(o['済']);
    if (o['済'] === 'TRUE' && !o['済んだ日']) o['済んだ日'] = today_();
    if (o['済'] !== 'TRUE') o['済んだ日'] = '';
    if (r > 0) writeRow_('やること', r, o);
    else {
      const nums = readAll_('やること').filter(x => x['案件番号'] === id).map(x => Number(x['番号']) || 0);
      o['番号'] = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
      appendObjs_('やること', [o]);
    }
    did.push('やること「' + name + '」' + (o['済'] === 'TRUE' ? 'を済にした' : 'を書いた'));
  }
  row['人の確認（残り）'] = remainingLabel_(id);
  row['更新日時'] = now_();
  writeObj_('案件', { '案件番号': id }, row);
  addLog_(id, who, b.log || did.join('。') || '事務の記録を受け取った');
  return { ok: true, '案件番号': id, did: did, case: getCase_(id) };
}

/** 照合表の根拠の欄に、リンクだけを書き込む：{案件番号, links:[{欄, 項目, col, url, label}]}（2026-10-02）。
 *  報告書を作り直さないので、人が入れた済とメモは消えない。col は 6〜8（F〜H。根拠1〜3）。
 *  行は、照合表の「欄」（C列）の名前で探し、なければ隠しシート「_照合」の項目の番号で探す */
function setLinks_(b) {
  const id = String(b['案件番号'] || '').trim();
  const row = getCase_(id);
  if (!row) throw new Error('案件が見つかりません：' + id);
  const m = /\/d\/([\w-]+)/.exec(row['報告書'] || '');
  if (!m) throw new Error('報告書のスプレッドシートがまだありません');
  const book = SpreadsheetApp.openById(m[1]);
  const sh = book.getSheetByName('照合表');
  if (!sh) throw new Error('報告書に照合表が見つかりません');
  const vals = sh.getDataRange().getValues();
  const hr = vals.findIndex(r => r[0] === '番号');
  const byLabel = {}, byItem = {};
  vals.forEach((r, i) => { if (i > hr && r[2]) byLabel[String(r[2]).trim()] = i + 1; });
  const hid = book.getSheetByName('_照合');
  if (hid) hid.getDataRange().getValues().slice(1).forEach(r => { if (r[2] && r[4]) byItem[String(r[2])] = Number(r[4]); });
  let n = 0;
  const missing = [];
  (b.links || []).forEach(L => {
    const r = byLabel[String(L['欄'] || '').trim()] || byItem[String(L['項目'] || '')];
    const col = Number(L.col) || 6;
    if (!r || col < 6 || col > 8 || !/^https:\/\//.test(String(L.url || ''))) { missing.push(L['欄'] || L['項目'] || '?'); return; }
    const label = String(L.label || '根拠を開く');
    sh.getRange(r, col).setRichTextValue(SpreadsheetApp.newRichTextValue().setText(label).setLinkUrl(String(L.url)).build());
    n++;
  });
  if (n) addLog_(id, BY_TOOL, '照合表の根拠にリンクを入れた：' + n + '件（報告書は作り直していない）');
  return { ok: true, set: n, missing: missing };
}

/** 照合の色を付け直す：{案件番号}。案件のフォルダのスプレッドシートのうち、照合表のあるものすべて。
 *  送り直さないので、照合表に書いた済やメモは消えない（2026-10-01） */
function recolor_(b) {
  const id = String(b['案件番号'] || '').trim();
  const row = getCase_(id);
  if (!row) throw new Error('案件が見つかりません：' + id);
  const it = caseFolder_(id, row['所在地番']).getFilesByType(MimeType.GOOGLE_SHEETS);
  const done = [];
  while (it.hasNext()) {
    const f = it.next();
    if (decorateCheck_(f.getId()) === 'ok') done.push(f.getName());
  }
  addLog_(id, BY_TOOL, '照合の色を付け直した：' + (done.join('、') || 'なし'));
  return { ok: true, files: done };
}

/** ファイル1本：{案件番号, name, mime, data(base64), kind} */
function receiveFile_(b) {
  const id = String(b['案件番号'] || '').trim();
  const row = getCase_(id);
  if (!row) throw new Error('先に案件を送ってください：' + id);
  if (!b.data) throw new Error('ファイルの中身がありません');
  const base = caseFolder_(id, row['所在地番']);
  // 根拠の資料は、案件のフォルダの中の小分けのフォルダに置く（2026-10-02 本人「ドライブに保存して、スプレッドシートにリンクを残す」）
  const sub = String(b.sub || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  const folder = sub ? subFolder_(base, sub) : base;
  const name = String(b.name || 'file.pdf').replace(/[\\/:*?"<>|]/g, '_');
  const same = folder.getFilesByName(name);
  while (same.hasNext()) same.next().setTrashed(true);   // 同じ名前の古い版はゴミ箱へ（戻せる）
  const bytes = Utilities.base64Decode(b.data);
  let f;
  if (b.convert && /\.xlsx$/i.test(name)) {
    // Excel を Googleスプレッドシートに変えて置く（2026-09-28 本人「最初から本物のスプレッドシートに」）
    const gname = name.replace(/\.xlsx$/i, '');
    const olds = folder.getFilesByName(gname);
    while (olds.hasNext()) olds.next().setTrashed(true);
    f = xlsxToSheet_(folder, gname, bytes);
    try { decorateCheck_(f.getId()); } catch (e) { addLog_(id, BY_TOOL, '照合の色とリンクを付けられなかった：' + e.message); }
    if (b.kind === '報告書') {   // 置いたらすぐ照合表の済を数える（画面に 0／全部 と出す）
      try { const n = countCheck_(f.getId()); if (n) row['照合の済'] = JSON.stringify(n); } catch (e) { /* 数えられなくても、置くことは続ける */ }
    }
  } else {
    f = folder.createFile(Utilities.newBlob(bytes, b.mime || 'application/pdf', name));
  }
  if (LINK_COLS.indexOf(b.kind) >= 0) row[b.kind] = f.getUrl();
  row['更新日時'] = now_();
  writeObj_('案件', { '案件番号': id }, row);
  addLog_(id, BY_TOOL, 'ファイルを置いた：' + name);
  return { ok: true, url: f.getUrl() };
}

/**
 * 「やること」を入れかえる。入れかえるのは Claude Code が足した行だけ。人が足した行は残す。
 * 同じ「やること」の行なら、人が入れた済・担当・メモ・リンクを残す。
 */
function replaceTasks_(id, items) {
  const all = readAll_('やること');
  const mine = all.filter(r => r['案件番号'] === id);
  const before = {};
  mine.filter(r => r['足した人'] === BY_TOOL).forEach(r => { before[r['やること']] = r; });
  const keep = mine.filter(r => r['足した人'] !== BY_TOOL);
  let next = Math.max(0, ...mine.map(r => Number(r['番号']) || 0)) + 1;
  const used = {};
  keep.forEach(r => { used[r['番号']] = true; });
  const rows = items.map(it => {
    const o = Object.assign({}, it, { '案件番号': id, '足した人': BY_TOOL });
    if (o['担当']) o['担当'] = nameFix_(o['担当']);
    const prev = before[o['やること']];
    if (prev) {
      o['番号'] = prev['番号'];
      ['済', '済んだ日', '担当', 'メモ', 'リンク'].forEach(k => {
        if (prev[k] && prev[k] !== 'FALSE' && (!o[k] || o[k] === 'FALSE' || k === '担当')) o[k] = prev[k];
      });
    }
    if (!o['番号'] || used[o['番号']]) o['番号'] = next++;
    used[o['番号']] = true;
    o['済'] = bool_(o['済']);
    return o;
  });
  deleteWhere_('やること', r => r['案件番号'] === id && r['足した人'] === BY_TOOL);
  appendObjs_('やること', rows);
}

/** 人の確認を入れかえる。同じ項目なら、人がつけた済とメモを残す */
function replaceChecks_(id, items) {
  const before = {};
  readAll_('人の確認').filter(r => r['案件番号'] === id).forEach(r => { before[r['確かめること']] = r; });
  const rows = items.map((it, i) => {
    const o = Object.assign({}, it, { '案件番号': id });
    if (!o['番号']) o['番号'] = i + 1;
    const prev = before[o['確かめること']];
    if (prev) {
      ['済', '済にした人', '済にした日時', 'メモ'].forEach(k => {
        if (prev[k] && prev[k] !== 'FALSE' && (!o[k] || o[k] === 'FALSE')) o[k] = prev[k];
      });
    }
    o['済'] = bool_(o['済']);
    return o;
  });
  const keep = readAll_('人の確認').filter(r => r['案件番号'] === id && DELIVERY.indexOf(r['確かめること']) >= 0);
  deleteWhere_('人の確認', r => r['案件番号'] === id);
  let next = Math.max(0, ...rows.map(r => Number(r['番号']) || 0));
  appendObjs_('人の確認', rows.concat(keep.filter(k => !rows.some(r => r['確かめること'] === k['確かめること'])).map(k => Object.assign(k, { '番号': ++next }))));
}

/** 報告書の納品の段で行う2つ（2026-10-02 本人「送ったら報告して、完了を押す」）。なければ足す。済やメモは残す */
const DELIVERY = ['報告書をクライアントに送る', '田中さんに「送りました」と報告する'];
function ensureDelivery_(id) {
  const mine = readAll_('人の確認').filter(r => r['案件番号'] === id);
  const have = mine.map(r => r['確かめること']);
  let no = Math.max(0, ...mine.map(r => Number(r['番号']) || 0));
  const add = DELIVERY.filter(t => have.indexOf(t) < 0).map(t => ({ '案件番号': id, '番号': ++no, '重さ': '', '確かめること': t,
    'いまの値と理由': '', 'どこで': '納品｜', '済': 'FALSE' }));
  if (add.length) appendObjs_('人の確認', add);
}

/** 報告書の欄を入れかえる（道具の出力だけなので、人の値は持たない） */
function replaceFields_(id, items) {
  deleteWhere_('報告書の欄', r => r['案件番号'] === id);
  appendObjs_('報告書の欄', items.map((it, i) => Object.assign({ '番号': i + 1 }, it, { '案件番号': id })));
}

/** 案件ごとのファイルを置く親フォルダ。スプレッドシートと同じ場所に「案件管理_案件ごとのファイル」を作る */
function rootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const rid = props.getProperty('ROOT_FOLDER_ID');
  if (rid) {
    try { return DriveApp.getFolderById(rid); } catch (e) { /* 消されていたら作り直す */ }
  }
  const parents = DriveApp.getFileById(ss_().getId()).getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const root = parent.createFolder('案件管理_案件ごとのファイル');
  props.setProperty('ROOT_FOLDER_ID', root.getId());
  return root;
}

/** 案件ごとのフォルダ（なければ作る）。名前は「A-0001 所在地番」 */
function caseFolder_(id, label) {
  const root = rootFolder_();
  const it = root.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName() === id || f.getName().indexOf(id + ' ') === 0) return f;
  }
  return root.createFolder(label ? id + ' ' + label : id);
}

/** 現地写真のフォルダ（なければ作る）。中に「現況」と「境界」（今までの成果品の写真帳の2冊に合わせた。2026-10-01） */
function photoFolder_(caseFolder) {
  const find = (parent, name) => { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); };
  const f = find(caseFolder, '現地写真');
  find(f, '現況'); find(f, '境界');
  return f;
}

/** 案件のフォルダの中の小分けのフォルダ（なければ作る）。根拠の資料など */
function subFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** 照合表の済を数える：{done, total, secs:{紙のシート:[済, 全部]}}。照合表のある報告書を開いて読む */
function countCheck_(fileId) {
  const chk = SpreadsheetApp.openById(fileId).getSheetByName('照合表');
  if (!chk) return null;
  const all = chk.getDataRange().getValues();
  const hr = all.findIndex(r => r[0] === '番号');
  if (hr < 0) return null;
  const out = { done: 0, total: 0, secs: {} };
  all.slice(hr + 1).forEach(r => {
    if (!r[0] && !r[2]) return;
    const sec = String(r[1] || 'その他'), ok = r[CHECK_DONE_COL - 1] === true || String(r[CHECK_DONE_COL - 1]).trim() === '済';
    out.secs[sec] = out.secs[sec] || [0, 0];
    out.secs[sec][1]++; out.total++;
    if (ok) { out.secs[sec][0]++; out.done++; }
  });
  return out;
}

/** xlsx を Drive API（REST）で取り込み、Googleスプレッドシートにする。拡張サービスを入れなくても動くように UrlFetchApp を使う */
function xlsxToSheet_(folder, name, bytes) {
  const boundary = 'b' + Utilities.getUuid().replace(/-/g, '');
  const meta = { name: name, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [folder.getId()] };
  const head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
    '\r\n--' + boundary + '\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n';
  const tail = '\r\n--' + boundary + '--';
  const payload = Utilities.newBlob(head).getBytes().concat(bytes).concat(Utilities.newBlob(tail).getBytes());
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: payload,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('スプレッドシートに変えられませんでした：' + res.getContentText().slice(0, 200));
  return DriveApp.getFileById(JSON.parse(res.getContentText()).id);
}

/** 照合の色（照合表のB3のチェックで出し入れ）と「欄へ飛ぶ」リンクを付ける（2026-09-29 本人「一々消すのはダルい」）。
 *  報告書には色を直接塗らない。条件付き書式が 照合表!B3 と、その項目の「済」（J列のチェック）を見る。
 *  B3にチェックがあり、済にチェックがない欄だけ色を出す（2026-10-01 本人「個別に色を外したい」）。
 *  何度呼んでもよい：前に付けた照合の書式は外してから付け直す。済の「済」の字はチェックに置き換える */
const CHECK_COLOR = { '一致': '#E2F0D9', '1出典': '#DDEBF7', '窓口確認': '#FFF2CC', '食い違い': '#F8CBAD', '未取得': '#FCE4D6' };
const CHECK_DONE_COL = 10;   // 照合表の「済」の列（J）
function decorateCheck_(fileId) {
  const ss = SpreadsheetApp.openById(fileId);
  const hid = ss.getSheetByName('_照合'), chk = ss.getSheetByName('照合表');
  if (!hid || !chk) return '';
  chk.getRange('B3').insertCheckboxes();
  if (chk.getRange('B3').getValue() === '') chk.getRange('B3').setValue(true);
  // 見出しの行（A列が「番号」）より下が項目の行
  const all = chk.getDataRange().getDisplayValues();
  const hr = all.findIndex(r => r[0] === '番号') + 1;
  if (!hr) return '';
  const last = chk.getLastRow();
  // 「済」の列をチェックボックスにする（前の版で「済」と書いた行はチェック済みにする）
  if (last > hr) {
    const done = chk.getRange(hr + 1, CHECK_DONE_COL, last - hr, 1);
    const vals = done.getValues().map(r => [r[0] === true || String(r[0]).trim() === '済']);
    done.clearDataValidations();
    done.insertCheckboxes();
    done.setValues(vals);
  }
  // 項目 → 照合表の行。_照合のE列（照合表の行）があればそれを使い、なければ「欄へ飛ぶ」の文字で探す
  const jump = {};
  all.forEach((r, i) => { if (i >= hr && r[11]) jump[r[11]] = i + 1; });
  const rowOf = {};
  const rows = hid.getDataRange().getValues().slice(1);
  rows.forEach(([t, rg, iid, st, cr]) => {
    if (!iid || rowOf[iid]) return;
    rowOf[iid] = Number(cr) || jump['→ ' + t + ' ' + String(rg).split(':')[0]] || 0;
  });
  // 報告書のシートごと・項目ごとに1本の書式（済の行が項目ごとに違うため）
  const bySheet = {};
  rows.forEach(([t, rg, iid, st]) => {
    if (!t || !rg || !CHECK_COLOR[st] || !rowOf[iid]) return;
    const key = iid + '\t' + st;
    bySheet[t] = bySheet[t] || {};
    (bySheet[t][key] = bySheet[t][key] || []).push(String(rg));
  });
  const isOurs = r => {
    const c = r.getBooleanCondition();
    return c && String((c.getCriteriaValues() || [])[0] || '').indexOf('照合表!') >= 0;
  };
  ss.getSheets().forEach(sh => {
    const t = sh.getName();
    if (t === '_照合') return;
    const rules = sh.getConditionalFormatRules().filter(r => !isOurs(r));
    if (t === '照合表' && last > hr) {
      // 済にチェックした行は、照合表の中でも灰色にして字を薄くする
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=INDIRECT("照合表!$J"&ROW())=TRUE')
        .setBackground('#EDEDED').setFontColor('#808080')
        .setRanges([chk.getRange(hr + 1, 1, last - hr, 12)]).build());
    }
    Object.keys(bySheet[t] || {}).forEach(key => {
      const [iid, st] = key.split('\t');
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND(INDIRECT("照合表!$B$3")=TRUE,INDIRECT("照合表!$J$' + rowOf[iid] + '")<>TRUE)')
        .setBackground(CHECK_COLOR[st])
        .setRanges(bySheet[t][key].map(a => sh.getRange(a))).build());
    });
    sh.setConditionalFormatRules(rules);
  });
  // 「欄へ飛ぶ」（12列目）：「→ シート名 A1」を、同じスプレッドシートの中へのリンクにする
  const gid = {};
  ss.getSheets().forEach(s => { gid[s.getName()] = s.getSheetId(); });
  const n = chk.getLastRow();
  chk.getRange(1, 12, n, 1).getValues().forEach((v, i) => {
    const m = /^→ (.+) ([A-Z]+\d+)$/.exec(String(v[0] || ''));
    if (!m || gid[m[1]] === undefined) return;
    chk.getRange(i + 1, 12).setFormula('=HYPERLINK("#gid=' + gid[m[1]] + '&range=' + m[2] + '","→ ' + m[1] + ' ' + m[2] + '")');
  });
  hid.hideSheet();
  return 'ok';
}

/** 人の目で確認の段階に入ったら、担当へメール。照合表の残りと、窓口で聞くことの★の数 */
function notify_(row) {
  const props = PropertiesService.getScriptProperties();
  const to = props.getProperty('NOTIFY_TO') || Session.getEffectiveUser().getEmail();
  const checks = readAll_('人の確認').filter(r => r['案件番号'] === row['案件番号'] && r['済'] !== 'TRUE' && DELIVERY.indexOf(r['確かめること']) < 0);
  const stars = checks.filter(r => r['重さ'] === '★').length;
  const first = checks.filter(r => r['重さ'] === '★')[0] || checks[0];
  const url = props.getProperty('APP_URL') || '';
  const lines = [
    row['案件番号'] + '（' + row['区分'] + '、' + row['自治体'] + '）の役所調査のたたき台ができました。',
    '照合表を開いて、根拠を確かめてください。',
    '',
    '窓口と現地で確かめることは ' + checks.length + ' 件です。そのうち★は ' + stars + ' 件です。',
    first ? 'いちばん先に確かめること：' + first['確かめること'] : null,
    row['期日'] ? '期日：' + row['期日'] : null,
    '',
    url ? '画面：' + url : '（画面のURLは、スクリプトのプロパティ APP_URL に入れると、ここに出ます）',
  ].filter(s => s !== null);
  MailApp.sendEmail({
    to: to,
    subject: '【照合待ち】' + row['案件番号'] + ' ★' + stars,
    body: lines.join('\n'),
    name: '案件管理',
  });
  addLog_(row['案件番号'], '案件管理', '確認待ちのメールを送った（★' + stars + '）');
}

// ─────────────────────────────────────────────
// 画面から呼ぶ（google.script.run）
// ─────────────────────────────────────────────

function getAll() {
  requireMember_();
  fixNames_();
  fixStageTasks_();
  const logs = readAll_('記録');
  return {
    today: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'),
    me: Session.getActiveUser().getEmail(),
    choices: CHOICES,
    stageNote: STAGE_NOTE,
    stageOwner: stageOwners_(),
    intakeTo: intakeTo_(),
    camera: CAMERA_URL,
    guide: readAll_('手引き'),
    names: names_(),
    cases: readAll_('案件').map(c => Object.assign(c, { '段階': stageFix_(c['段階']) })),
    tasks: readAll_('やること'),
    checks: readAll_('人の確認'),
    fields: readAll_('報告書の欄'),
    logs: logs.slice(-400).reverse(),
  };
}

/** 照合表の済を読み直して、案件の「照合の済」に書く（案件の画面の「照合表から読み直す」） */
function refreshCheck(id) {
  const who = requireMember_();
  return withLock_(() => {
    const row = getCase_(id);
    if (!row) throw new Error('案件が見つかりません：' + id);
    const m = /\/d\/([\w-]+)/.exec(row['報告書'] || '');
    if (!m) throw new Error('報告書のスプレッドシートがまだありません');
    const n = countCheck_(m[1]);
    if (!n) throw new Error('報告書に照合表が見つかりません');
    const before = row['照合の済'];
    row['照合の済'] = JSON.stringify(n);
    if (before !== row['照合の済']) {
      row['更新日時'] = now_();
      writeObj_('案件', { '案件番号': id }, row);
      addLog_(id, who, '照合表の済を読み直した：' + n.done + '／' + n.total);
    }
    return getAll();
  });
}

/** 案件を消す（2026-10-02 本人「間違って作った案件を消したい」）。案件・やること・確認・報告書の欄の行を消す。
 *  ドライブのフォルダとファイルは消さない（あとから戻せるように）。記録には残す */
function removeCase_(id, who) {
  const row = getCase_(id);
  if (!row) throw new Error('案件が見つかりません：' + id);
  ['やること', '人の確認', '報告書の欄'].forEach(n => deleteWhere_(n, r => r['案件番号'] === id));
  deleteWhere_('案件', r => r['案件番号'] === id);
  addLog_(id, who, '案件を消した（' + (row['区分'] || '') + '、' + (row['所在地番'] || '') + '）。ドライブのフォルダは残した');
  return { ok: true, removed: id };
}
function removeCase(id) {
  const who = requireMember_();
  return withLock_(() => { removeCase_(id, who); return getAll(); });
}

/** 案件を画面から足す（Claude Code を通さない案件。建物・確定測量など） */
function addCase(fields) {
  const who = requireMember_();
  return withLock_(() => {
    const f = fields || {};
    if (!String(f['所在地番'] || '').trim()) throw new Error('所在地番を入れてください');
    const nums = readAll_('案件').map(r => (/^A-(\d+)$/.exec(r['案件番号']) || [])[1]).filter(Boolean).map(Number);
    const id = 'A-' + ('000' + ((nums.length ? Math.max.apply(null, nums) : 0) + 1)).slice(-4);
    const row = { '案件番号': id, '受付日': today_(), '段階': '受付', '保留': 'FALSE', '更新日時': now_() };
    EDITABLE.forEach(k => { if (f[k] !== undefined && f[k] !== '') row[k] = String(f[k]); });
    if (!row['主担当']) row['主担当'] = CASE_OWNER;
    row['人の確認（残り）'] = '0';
    writeObj_('案件', { '案件番号': id }, row);
    addLog_(id, who, '画面から案件を足した');
    const d = getAll();
    d.opened = id;
    return d;
  });
}

/** 案件の列を変える。変えてよい列だけ */
function updateCase(id, patch) {
  const who = requireMember_();
  return withLock_(() => {
    const row = getCase_(id);
    if (!row) throw new Error('案件が見つかりません：' + id);
    const changed = [];
    Object.keys(patch || {}).forEach(k => {
      if (EDITABLE.indexOf(k) < 0) return;
      let v = patch[k] === null || patch[k] === undefined ? '' : String(patch[k]);
      if (k === '保留') v = bool_(v);
      if (k === '主担当') v = nameFix_(v);
      if (k === '段階') v = stageFix_(v);
      if (k === '段階' && CHOICES['段階'].indexOf(v) < 0) throw new Error('段階が選択肢にありません：' + v);
      if (k === '段階' && v === '完了' && row['区分'] !== '許認可') {
        ensureDelivery_(id);
        const left = readAll_('人の確認').filter(r => r['案件番号'] === id && DELIVERY.indexOf(r['確かめること']) >= 0 && r['済'] !== 'TRUE');
        if (left.length) throw new Error('完了にする前に、済にしてください：' + left.map(r => r['確かめること']).join('、'));
      }
      if (k === '段階' && v === '報告書の納品') ensureDelivery_(id);
      if ((row[k] || '') === v) return;
      if (k === 'メモ') changed.push('メモを書きかえた');
      else if (k === '保留') changed.push(v === 'TRUE' ? '保留にした' : '保留をといた');
      else changed.push(k + 'を「' + (row[k] || '空') + '」から「' + (v || '空') + '」にした');
      row[k] = v;
    });
    if (changed.length) {
      row['更新日時'] = now_();
      writeObj_('案件', { '案件番号': id }, row);
      addLog_(id, who, changed.join('。'));
      if ('段階' in (patch || {})) { if (row['区分'] === '許認可') syncTasks_(id, row['段階']); else ensureStageTasks_(id); }
    }
    return getAll();
  });
}

/** 段階に合わせて、工程（やること）の済をそろえる（2026-10-02 本人「段階の帯でチェックして完了にしたい」）。
 *  今の段階より前の段の行は済、今の段階とそれより後は済をはずす。段の名前を含まない行は触らない */
const TASK_STAGE = [['受付', '受付'], ['たたき台', 'たたき台の作成'], ['人の目', '人の目で確認'], ['窓口', '窓口で確認'],
  ['現地', '現地調査'], ['最終', '最終チェック'], ['納品', '報告書の納品']];
function syncTasks_(id, stage) {
  const st = CHOICES['段階'], cur = st.indexOf(stage);
  const sh = sh_('やること'), cols = SHEETS['やること'];
  readAll_('やること').forEach((t, i) => {
    if (t['案件番号'] !== id) return;
    const hit = TASK_STAGE.find(([k]) => String(t['やること']).indexOf(k) >= 0);
    if (!hit) return;
    const want = st.indexOf(hit[1]) < cur ? 'TRUE' : 'FALSE';
    if (t['済'] === want) return;
    t['済'] = want; t['済んだ日'] = want === 'TRUE' ? today_() : '';
    writeRow_('やること', i + 2, t);
  });
}

/** やることを足す */
function addTask(id, t) {
  const who = requireMember_();
  return withLock_(() => {
    if (!getCase_(id)) throw new Error('案件が見つかりません：' + id);
    const o = {};
    TASK_EDITABLE.forEach(k => { if (t && t[k] !== undefined) o[k] = String(t[k]); });
    if (o['担当']) o['担当'] = nameFix_(o['担当']);
    if (!String(o['やること'] || '').trim()) throw new Error('やることを入れてください');
    if (o['開始日'] && o['終了日'] && o['終了日'] < o['開始日']) throw new Error('終わりの日が、始まりの日より前です');
    const nums = readAll_('やること').filter(r => r['案件番号'] === id).map(r => Number(r['番号']) || 0);
    o['案件番号'] = id;
    o['番号'] = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
    o['済'] = bool_(o['済']);
    o['足した人'] = who;
    appendObjs_('やること', [o]);
    touch_(id);
    addLog_(id, who, 'やることを足した：' + o['やること'] + (o['担当'] ? '（' + o['担当'] + '）' : ''));
    return getAll();
  });
}

/** やることを変える（済・担当・日付・メモ・リンク） */
function updateTask(id, no, patch) {
  const who = requireMember_();
  return withLock_(() => {
    const r = findRow_('やること', { '案件番号': id, '番号': String(no) });
    if (r < 0) throw new Error('やることが見つかりません');
    const o = rowObj_('やること', r);
    const changed = [];
    Object.keys(patch || {}).forEach(k => {
      if (TASK_EDITABLE.indexOf(k) < 0) return;
      let v = patch[k] === null || patch[k] === undefined ? '' : String(patch[k]);
      if (k === '済') v = bool_(v);
      if (k === '担当') v = nameFix_(v);
      if ((o[k] || '') === v) return;
      if (k === '済') { o['済んだ日'] = v === 'TRUE' ? today_() : ''; changed.push(v === 'TRUE' ? '済にした' : '済をはずした'); }
      else if (k === 'メモ' || k === 'リンク') changed.push(k + 'を書きかえた');
      else changed.push(k + 'を「' + (o[k] || '空') + '」から「' + (v || '空') + '」にした');
      o[k] = v;
    });
    if (o['開始日'] && o['終了日'] && o['終了日'] < o['開始日']) throw new Error('終わりの日が、始まりの日より前です');
    if (changed.length) {
      writeRow_('やること', r, o);
      touch_(id);
      addLog_(id, who, o['やること'] + '：' + changed.join('。'));
    }
    return getAll();
  });
}

/** やることを消す */
function removeTask(id, no) {
  const who = requireMember_();
  return withLock_(() => {
    const r = findRow_('やること', { '案件番号': id, '番号': String(no) });
    if (r < 0) throw new Error('やることが見つかりません');
    const o = rowObj_('やること', r);
    sh_('やること').deleteRow(r);
    touch_(id);
    addLog_(id, who, 'やることを消した：' + o['やること']);
    return getAll();
  });
}

/** 人の確認に「済」をつける、はずす */
function setCheck(id, no, done) {
  const who = requireMember_();
  return withLock_(() => {
    const r = findRow_('人の確認', { '案件番号': id, '番号': String(no) });
    if (r < 0) throw new Error('確認の項目が見つかりません');
    const o = rowObj_('人の確認', r);
    o['済'] = done ? 'TRUE' : 'FALSE';
    o['済にした人'] = done ? who : '';
    o['済にした日時'] = done ? now_() : '';
    writeRow_('人の確認', r, o);
    const row = getCase_(id);
    row['人の確認（残り）'] = remainingLabel_(id);
    row['更新日時'] = now_();
    writeObj_('案件', { '案件番号': id }, row);
    addLog_(id, who, (done ? '確認を済にした：' : '確認の済をはずした：') + o['確かめること']);
    return getAll();
  });
}

/** 人の確認に、聞いた答え（メモ）を書く。done を渡したときは済も変える（2026-09-29 本人「書き込めない」） */
function setCheckMemo(id, no, memo, done) {
  const who = requireMember_();
  return withLock_(() => {
    const r = findRow_('人の確認', { '案件番号': id, '番号': String(no) });
    if (r < 0) throw new Error('確認の項目が見つかりません');
    const o = rowObj_('人の確認', r);
    const before = o['メモ'];
    o['メモ'] = String(memo == null ? '' : memo).trim();
    if (done != null && bool_(done) !== o['済']) {
      o['済'] = bool_(done);
      o['済にした人'] = o['済'] === 'TRUE' ? who : '';
      o['済にした日時'] = o['済'] === 'TRUE' ? now_() : '';
    }
    writeRow_('人の確認', r, o);
    const row = getCase_(id);
    row['人の確認（残り）'] = remainingLabel_(id);
    row['更新日時'] = now_();
    writeObj_('案件', { '案件番号': id }, row);
    if (o['メモ'] !== before) addLog_(id, who, '確認に答えを書いた：' + o['確かめること']);
    return getAll();
  });
}

// ─────────────────────────────────────────────
// 表の読み書き
// ─────────────────────────────────────────────

/** 開いた表は1回の実行の中で使い回す（開き直すと遅くなる） */
let SS_ = null;
const SH_ = {};
function ss_() {
  if (!SS_) SS_ = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  return SS_;
}

/** シートを用意する（なければ作る）。日付が勝手に日付型にならないよう、全部「書式なしテキスト」にする */
function sh_(name) {
  if (SH_[name]) return SH_[name];
  let sh = ss_().getSheetByName(name);
  if (sh) {
    // 列が増えた版（v0.3 の「照合の済」「現地写真」など）は、見出しの行だけ足す
    const cols = SHEETS[name], have = sh.getLastColumn();
    if (have < cols.length) {
      sh.getRange(1, have + 1, 1, cols.length - have).setValues([cols.slice(have)])
        .setFontWeight('bold').setBackground('#1F4E79').setFontColor('#FFFFFF');
      sh.getRange(2, have + 1, sh.getMaxRows() - 1, cols.length - have).setNumberFormat('@');
    }
    return (SH_[name] = sh);
  }
  const cols = SHEETS[name];
  sh = ss_().insertSheet(name);
  sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  sh.getRange(1, 1, 1, cols.length).setValues([cols])
    .setFontWeight('bold').setBackground('#1F4E79').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  const list = (k, col) => sh.getRange(2, cols.indexOf(col) + 1, sh.getMaxRows() - 1, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CHOICES[k], true).setAllowInvalid(true).build());
  if (name === '案件') {
    sh.setFrozenColumns(1);
    list('区分', '区分'); list('段階', '段階'); list('担当', '主担当');
  }
  if (name === 'やること') { list('担当', '担当'); list('分類', '分類'); }
  if (name === '標準日数') appendRows_(sh, STD_SEED.map(r => r.map(String)));
  if (name === '手引き') appendRows_(sh, GUIDE_SEED.map(r => r.concat(['']).map(String)));
  const first = ss_().getSheetByName('シート1');   // 新しいスプレッドシートにある空のシートは消す
  if (first && first.getLastRow() === 0 && ss_().getSheets().length > 1) ss_().deleteSheet(first);
  return (SH_[name] = sh);
}

function readAll_(name) {
  const sh = sh_(name);
  const cols = SHEETS[name];
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, cols.length).getDisplayValues()
    .filter(r => r.some(v => v !== ''))
    .map(r => { const o = {}; cols.forEach((c, i) => { o[c] = r[i]; }); return o; });
}

function rowObj_(name, r) {
  const cols = SHEETS[name];
  const v = sh_(name).getRange(r, 1, 1, cols.length).getDisplayValues()[0];
  const o = {};
  cols.forEach((c, i) => { o[c] = v[i]; });
  return o;
}

function getCase_(id) {
  return readAll_('案件').filter(r => r['案件番号'] === id)[0] || null;
}

function findRow_(name, match) {
  const sh = sh_(name);
  const cols = SHEETS[name];
  const n = sh.getLastRow();
  if (n < 2) return -1;
  const vals = sh.getRange(2, 1, n - 1, cols.length).getDisplayValues();
  const keys = Object.keys(match).map(k => [cols.indexOf(k), String(match[k])]);
  for (let i = 0; i < vals.length; i++) {
    if (keys.every(([j, v]) => vals[i][j] === v)) return i + 2;
  }
  return -1;
}

function toVals_(name, obj) {
  return SHEETS[name].map(c => (obj[c] === undefined || obj[c] === null) ? '' : String(obj[c]));
}

function writeRow_(name, r, obj) {
  sh_(name).getRange(r, 1, 1, SHEETS[name].length).setNumberFormat('@').setValues([toVals_(name, obj)]);
}

/** 1行を書く（あれば上書き、なければ足す） */
function writeObj_(name, match, obj) {
  const r = findRow_(name, match);
  if (r > 0) writeRow_(name, r, obj);
  else appendRows_(sh_(name), [toVals_(name, obj)]);
}

function appendObjs_(name, objs) {
  appendRows_(sh_(name), objs.map(o => toVals_(name, o)));
}

function appendRows_(sh, rows) {
  if (!rows.length) return;
  const start = sh.getLastRow() + 1;
  const need = start + rows.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 100);
  sh.getRange(start, 1, rows.length, rows[0].length).setNumberFormat('@').setValues(rows);
}

/** 条件に合う行を下から消す */
function deleteWhere_(name, pred) {
  const sh = sh_(name);
  const all = readAll_(name);
  for (let i = all.length - 1; i >= 0; i--) {
    if (pred(all[i])) sh.deleteRow(i + 2);
  }
}

function addLog_(id, who, text) {
  appendRows_(sh_('記録'), [[now_(), id, who, text]]);
}

function touch_(id) {
  const row = getCase_(id);
  if (!row) return;
  row['更新日時'] = now_();
  writeObj_('案件', { '案件番号': id }, row);
}

function remainingLabel_(id) {
  const rest = readAll_('人の確認').filter(r => r['案件番号'] === id && r['済'] !== 'TRUE' && DELIVERY.indexOf(r['確かめること']) < 0);
  const stars = rest.filter(r => r['重さ'] === '★').length;
  return rest.length ? rest.length + '（★' + stars + '）' : '0';
}

/** 担当者の名前から「さん」を外す（2026-09-28 本人「担当者の名前はさんづけを外して」） */
const RENAME = {};   // 呼び名が変わった人（2026-09-30 本人）
function nameFix_(v) { const n = String(v == null ? '' : v).trim().replace(/さん$/, ''); return RENAME[n] || n; }

/** 表に入っている「◯◯さん」を一度だけ直す。直したら NAMES_FIXED に印をつける */
function fixNames_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('NAMES_FIXED') === '2') return;   // 2＝呼び名を直す版
  [['案件', '主担当'], ['やること', '担当']].forEach(([name, col]) => {
    const sh = sh_(name), n = sh.getLastRow();
    if (n < 2) return;
    const j = SHEETS[name].indexOf(col) + 1;
    const rg = sh.getRange(2, j, n - 1, 1);
    const vals = rg.getDisplayValues();
    if (vals.some(r => nameFix_(r[0]) !== r[0])) rg.setValues(vals.map(r => [nameFix_(r[0])]));
  });
  try {
    const m = JSON.parse(props.getProperty('NAMES') || '{}');
    Object.keys(m).forEach(k => { m[k] = nameFix_(m[k]); });
    props.setProperty('NAMES', JSON.stringify(m));
  } catch (e) { /* 読めなければそのまま */ }
  props.setProperty('NAMES_FIXED', '2');
}

function bool_(v) { return v === true || v === 'TRUE' || v === 'true' ? 'TRUE' : 'FALSE'; }
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ─────────────────────────────────────────────
// 使える人
// ─────────────────────────────────────────────

/** メールから呼び名へ（スクリプト プロパティ NAMES に {"メール":"木村"} の形で入れる） */
function names_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('NAMES') || '{}'); } catch (e) { return {}; }
}

function members_() {
  const p = PropertiesService.getScriptProperties().getProperty('MEMBERS') || '';
  const owner = Session.getEffectiveUser().getEmail();
  return p.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).concat([owner.toLowerCase()]);
}

function isMember_() {
  return true;   // 見本の版：だれでも開ける（2026-10-28）
}

function requireMember_() {
  return Session.getActiveUser().getEmail() || '見本の利用者';
}

/** 最初に1回だけ、Apps Script の画面で「実行」を押す。5枚のシートを作り、許可の画面を出す */
function setup() {
  Object.keys(SHEETS).forEach(sh_);
  rootFolder_();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('NAMES')) {
    const n = {}; n[Session.getEffectiveUser().getEmail()] = '木村';
    props.setProperty('NAMES', JSON.stringify(n));
  }
  const t = PropertiesService.getScriptProperties().getProperty('TOKEN');
  Logger.log('シートを用意しました。合言葉：' + (t ? '入っています' : 'まだです（README の手順7）'));
}

/** 外部のサービスへの接続（スプレッドシートへの変換に使う）の許可を出すために、エディタで1回だけ実行する */
function allowConvert() {
  const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  Logger.log('変換の許可：' + (r.getResponseCode() === 200 ? '使えます' : '使えません（' + r.getResponseCode() + '）'));
}

/** 使う人を足す（2026-09-30 本人の了承。エディタで1回実行する）。画面を使える人（MEMBERS）と呼び名（NAMES）に足す。
 *  表とファイルのフォルダの共有は、本人がドライブの上のフォルダで済ませた（2026-09-30） */
const TEAM = {};
function addTeam() {
  const emails = Object.keys(TEAM);
  const props = PropertiesService.getScriptProperties();
  const mem = (props.getProperty('MEMBERS') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  emails.forEach(e => { if (mem.indexOf(e.toLowerCase()) < 0) mem.push(e.toLowerCase()); });
  props.setProperty('MEMBERS', mem.join(','));
  const names = names_();
  emails.forEach(e => { names[e] = TEAM[e]; });
  props.setProperty('NAMES', JSON.stringify(names));
  Logger.log('MEMBERS：' + mem.join(', ') + '\nNAMES：' + JSON.stringify(names));
}
