window.APP_CONFIG = Object.freeze({
  eventName: "臺南市議員第十一選區選舉",

  // 填入 Supabase Project URL 與 anon public key 後，即切換為正式連線模式。
  // anon key 可公開於前端；絕對不要填入 service_role key。
  supabaseUrl: "https://qwatxanlmqponcnjazno.supabase.co",
  supabaseAnonKey: "sb_publishable_9fulzz1IswPubKBRO7tpiw__9qu8Us1",

  publicRefreshIntervalMs: 2000,
  adminRefreshIntervalMs: 4000,
});
