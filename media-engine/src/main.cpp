#include <gst/gst.h>
#include <gst/webrtc/webrtc.h>
#include <gst/sdp/sdp.h>
#include <libsoup/soup.h>
#include <json-glib/json-glib.h>
#include <glib-unix.h>
#include <atomic>
#include <cstdlib>
#include <csignal>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

struct App {
  GMainLoop* loop = nullptr;
  GstElement* pipeline = nullptr;
  GstElement* rtc = nullptr;
  SoupWebsocketConnection* ws = nullptr;
  std::atomic<bool> offered{false};
  bool remote_set = false;
  std::atomic<int> exit_code{0};
  std::string room = "native-demo", title = "StreamForge native source";
  std::string url = "ws://127.0.0.1:8080/ws", stun, turn, token;
  std::vector<std::pair<guint, std::string>> pending;
};

static std::string encode(JsonObject* object) {
  JsonNode* node = json_node_new(JSON_NODE_OBJECT);
  json_node_take_object(node, object);
  gchar* text = json_to_string(node, FALSE);
  std::string result(text); g_free(text); json_node_free(node);
  return result;
}
static JsonObject* message(const char* type) {
  auto* o = json_object_new(); json_object_set_string_member(o, "type", type); return o;
}
struct Send { App* app; std::string json; };
static void send(App* app, JsonObject* object) {
  auto* task = new Send{app, encode(object)};
  g_main_context_invoke(nullptr, [](gpointer data) -> gboolean {
    auto* item = static_cast<Send*>(data);
    if (item->app->ws && soup_websocket_connection_get_state(item->app->ws) == SOUP_WEBSOCKET_STATE_OPEN)
      soup_websocket_connection_send_text(item->app->ws, item->json.c_str());
    delete item; return G_SOURCE_REMOVE;
  }, task);
}
static void stop(App* app, const std::string& reason) {
  std::cerr << reason << '\n'; app->exit_code = 1; g_main_loop_quit(app->loop);
}
static void offer_created(GstPromise* promise, gpointer data) {
  auto* app = static_cast<App*>(data);
  GstWebRTCSessionDescription* offer = nullptr;
  if (gst_promise_wait(promise) == GST_PROMISE_RESULT_REPLIED) {
    const GstStructure* reply = gst_promise_get_reply(promise);
    if (reply) gst_structure_get(reply, "offer", GST_TYPE_WEBRTC_SESSION_DESCRIPTION, &offer, nullptr);
  }
  gst_promise_unref(promise);
  if (!offer) { stop(app, "Failed to create WebRTC offer"); return; }
  g_signal_emit_by_name(app->rtc, "set-local-description", offer, nullptr);
  gchar* sdp = gst_sdp_message_as_text(offer->sdp);
  auto* o = message("offer"); auto* description = json_object_new();
  json_object_set_string_member(description, "type", "offer");
  json_object_set_string_member(description, "sdp", sdp);
  json_object_set_object_member(o, "sdp", description); send(app, o);
  g_free(sdp); gst_webrtc_session_description_free(offer);
}
static void negotiate(GstElement*, gpointer data) {
  auto* app = static_cast<App*>(data);
  if (app->offered.exchange(true)) return;
  auto* promise = gst_promise_new_with_change_func(offer_created, app, nullptr);
  g_signal_emit_by_name(app->rtc, "create-offer", nullptr, promise);
}
static void ice_candidate(GstElement*, guint index, gchar* candidate, gpointer data) {
  auto* o = message("candidate"); auto* c = json_object_new();
  json_object_set_int_member(c, "sdpMLineIndex", index);
  json_object_set_string_member(c, "candidate", candidate);
  json_object_set_object_member(o, "candidate", c); send(static_cast<App*>(data), o);
}
static const gchar* string_member(JsonObject* o, const char* name) {
  return json_object_has_member(o, name) ? json_object_get_string_member(o, name) : "";
}
static void incoming(SoupWebsocketConnection*, gint type, GBytes* bytes, gpointer data) {
  auto* app = static_cast<App*>(data); if (type != SOUP_WEBSOCKET_DATA_TEXT) return;
  gsize size = 0; const auto* text = static_cast<const gchar*>(g_bytes_get_data(bytes, &size));
  GError* error = nullptr; auto* parser = json_parser_new();
  if (!json_parser_load_from_data(parser, text, static_cast<gssize>(size), &error)) {
    std::cerr << "Invalid signaling JSON: " << error->message << '\n'; g_clear_error(&error); g_object_unref(parser); return;
  }
  JsonNode* root = json_parser_get_root(parser);
  if (!JSON_NODE_HOLDS_OBJECT(root)) { g_object_unref(parser); return; }
  auto* o = json_node_get_object(root); const std::string kind = string_member(o, "type");
  if (kind == "ready") {
    const std::string viewer_token = string_member(o, "viewerToken");
    std::cout << "Publishing " << app->room << ". Viewer: /watch/" << app->room;
    if (!viewer_token.empty()) std::cout << "#" << viewer_token;
    std::cout << std::endl;
    if (gst_element_set_state(app->pipeline, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE) stop(app, "Cannot start media pipeline");
  } else if (kind == "answer") {
    auto* desc = json_object_get_object_member(o, "sdp"); const gchar* sdp_text = string_member(desc, "sdp");
    GstSDPMessage* sdp = nullptr; gst_sdp_message_new(&sdp);
    if (gst_sdp_message_parse_buffer(reinterpret_cast<const guint8*>(sdp_text), static_cast<guint>(strlen(sdp_text)), sdp) != GST_SDP_OK) {
      gst_sdp_message_free(sdp); stop(app, "Invalid remote SDP");
    } else {
      auto* answer = gst_webrtc_session_description_new(GST_WEBRTC_SDP_TYPE_ANSWER, sdp);
      auto* promise = gst_promise_new();
      g_signal_emit_by_name(app->rtc, "set-remote-description", answer, promise);
      auto result = gst_promise_wait(promise);
      if (result != GST_PROMISE_RESULT_REPLIED) stop(app, "Failed to apply remote description");
      else {
        app->remote_set = true;
        for (auto& c : app->pending) g_signal_emit_by_name(app->rtc, "add-ice-candidate", c.first, c.second.c_str());
        app->pending.clear();
      }
      gst_promise_unref(promise); gst_webrtc_session_description_free(answer);
    }
  } else if (kind == "candidate") {
    auto* c = json_object_get_object_member(o, "candidate");
    const auto index = static_cast<guint>(json_object_get_int_member(c, "sdpMLineIndex"));
    const gchar* value = string_member(c, "candidate");
    if (app->remote_set) g_signal_emit_by_name(app->rtc, "add-ice-candidate", index, value);
    else app->pending.emplace_back(index, value);
  } else if (kind == "connection") {
    std::cout << "Transport: " << string_member(o, "state") << std::endl;
  } else if (kind == "error") stop(app, string_member(o, "error"));
  g_object_unref(parser);
}
static void connected(GObject* source, GAsyncResult* result, gpointer data) {
  auto* app = static_cast<App*>(data); GError* error = nullptr;
  app->ws = soup_session_websocket_connect_finish(SOUP_SESSION(source), result, &error);
  if (!app->ws) { stop(app, std::string("Signaling: ") + error->message); g_clear_error(&error); return; }
  g_signal_connect(app->ws, "message", G_CALLBACK(incoming), app);
  g_signal_connect(app->ws, "closed", G_CALLBACK(+[](SoupWebsocketConnection*, gpointer d) {stop(static_cast<App*>(d), "Signaling connection closed");}), app);
  auto* o = message("publish"); json_object_set_int_member(o, "tracks", 2); json_object_set_string_member(o, "roomId", app->room.c_str());
  json_object_set_string_member(o, "title", app->title.c_str());
  if (!app->token.empty()) json_object_set_string_member(o, "token", app->token.c_str());
  send(app, o);
}
static gboolean bus_message(GstBus*, GstMessage* msg, gpointer data) {
  auto* app = static_cast<App*>(data);
  if (GST_MESSAGE_TYPE(msg) == GST_MESSAGE_ERROR) {
    GError* error = nullptr; gchar* debug = nullptr; gst_message_parse_error(msg, &error, &debug);
    stop(app, std::string("GStreamer: ") + error->message); if (debug) std::cerr << debug << '\n';
    g_clear_error(&error); g_free(debug);
  } else if (GST_MESSAGE_TYPE(msg) == GST_MESSAGE_EOS) g_main_loop_quit(app->loop);
  return G_SOURCE_CONTINUE;
}
int main(int argc, char** argv) {
  gst_init(&argc, &argv); App app; bool camera = false; int width = 1280, height = 720, fps = 30, bitrate = 2500;
  if (const char* token = std::getenv("STREAMFORGE_AUTH_SECRET")) app.token = token;
  try {
    for (int i = 1; i < argc; ++i) {
      std::string arg(argv[i]);
      auto value = [&]() -> std::string {if (++i >= argc) throw std::runtime_error("Missing value for " + arg); return argv[i];};
      if (arg == "--camera") camera = true;
      else if (arg == "--test") camera = false;
      else if (arg == "--url") app.url = value();
      else if (arg == "--room") app.room = value();
      else if (arg == "--title") app.title = value();
      else if (arg == "--width") width = std::stoi(value());
      else if (arg == "--height") height = std::stoi(value());
      else if (arg == "--fps") fps = std::stoi(value());
      else if (arg == "--bitrate") bitrate = std::stoi(value());
      else if (arg == "--stun") app.stun = value();
      else if (arg == "--turn") app.turn = value();
      else if (arg == "--token") app.token = value();
      else if (arg == "--help") {
        std::cout << "StreamForge native H.264 + Opus WebRTC sender\n"
          "  --test (default) | --camera (webcam + microphone)\n"
          "  --url ws://127.0.0.1:8080/ws --room native-demo --title TEXT\n"
          "  --width 1280 --height 720 --fps 30 --bitrate 2500 (kbps)\n"
          "  --token STREAMFORGE_AUTH_SECRET\n"
          "  --stun stun://host:3478 --turn turn://user:password@host:3478\n"; return 0;
      } else throw std::runtime_error("Unknown option " + arg);
    }
    if (width < 160 || width > 3840 || height < 120 || height > 2160 || fps < 1 || fps > 60 || bitrate < 100 || bitrate > 50000)
      throw std::runtime_error("Video settings outside supported range");
  } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 2; }
#ifdef __APPLE__
  const std::string camera_source = "avfvideosrc";
  const std::string mic_source = "osxaudiosrc";
#else
  const std::string camera_source = "autovideosrc";
  const std::string mic_source = "autoaudiosrc";
#endif
  const std::string video = camera ? camera_source : "videotestsrc is-live=true pattern=ball";
  const std::string audio = camera ? mic_source : "audiotestsrc is-live=true wave=sine volume=0.08";
  const std::string pipeline = "webrtcbin name=rtc bundle-policy=max-bundle " + video +
    " ! videoconvert ! videoscale ! videorate ! video/x-raw,format=I420,width=" + std::to_string(width) +
    ",height=" + std::to_string(height) + ",framerate=" + std::to_string(fps) + "/1 ! "
    "x264enc name=encoder tune=zerolatency speed-preset=veryfast bframes=0 bitrate=" + std::to_string(bitrate) +
    " key-int-max=" + std::to_string(fps) + " ! video/x-h264,profile=constrained-baseline ! "
    "rtph264pay config-interval=-1 pt=96 ! application/x-rtp,media=video,encoding-name=H264,payload=96 ! queue ! rtc. " +
    audio + " ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! "
    "opusenc bitrate=64000 ! rtpopuspay pt=111 ! application/x-rtp,media=audio,encoding-name=OPUS,payload=111 ! queue ! rtc.";
  GError* error = nullptr; app.pipeline = gst_parse_launch(pipeline.c_str(), &error);
  if (error || !app.pipeline) {
    std::cerr << "Cannot build pipeline: " << (error ? error->message : "unknown error") << '\n';
    g_clear_error(&error); if (app.pipeline) gst_object_unref(app.pipeline); return 1;
  }
  app.rtc = gst_bin_get_by_name(GST_BIN(app.pipeline), "rtc");
  if (!app.stun.empty()) g_object_set(app.rtc, "stun-server", app.stun.c_str(), nullptr);
  if (!app.turn.empty()) g_object_set(app.rtc, "turn-server", app.turn.c_str(), nullptr);
  g_signal_connect(app.rtc, "on-negotiation-needed", G_CALLBACK(negotiate), &app);
  g_signal_connect(app.rtc, "on-ice-candidate", G_CALLBACK(ice_candidate), &app);
  app.loop = g_main_loop_new(nullptr, FALSE);
  auto* bus = gst_element_get_bus(app.pipeline); const guint bus_watch = gst_bus_add_watch(bus, bus_message, &app); gst_object_unref(bus);
  const guint interrupt = g_unix_signal_add(SIGINT, +[](gpointer d) -> gboolean { g_main_loop_quit(static_cast<App*>(d)->loop); return G_SOURCE_CONTINUE; }, &app);
  const guint terminate = g_unix_signal_add(SIGTERM, +[](gpointer d) -> gboolean { g_main_loop_quit(static_cast<App*>(d)->loop); return G_SOURCE_CONTINUE; }, &app);
  auto* session = soup_session_new(); auto* request = soup_message_new("GET", app.url.c_str());
  if (!request) { std::cerr << "Invalid signaling URL\n"; return 2; }
  soup_session_websocket_connect_async(session, request, nullptr, nullptr, G_PRIORITY_DEFAULT, nullptr, connected, &app);
  g_object_unref(request); g_main_loop_run(app.loop);
  gst_element_set_state(app.pipeline, GST_STATE_NULL);
  if (app.ws) { g_signal_handlers_disconnect_by_data(app.ws, &app); soup_websocket_connection_close(app.ws, SOUP_WEBSOCKET_CLOSE_NORMAL, "Publisher stopped"); g_object_unref(app.ws); app.ws = nullptr; }
  g_source_remove(bus_watch); g_source_remove(interrupt); g_source_remove(terminate);
  gst_object_unref(app.rtc); gst_object_unref(app.pipeline); g_object_unref(session);
  while (g_main_context_pending(nullptr)) g_main_context_iteration(nullptr, FALSE);
  g_main_loop_unref(app.loop); return app.exit_code;
}
