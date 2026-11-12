fn main() {
    // The Aptabase key comes from the release workflow, so rebuild when it changes.
    println!("cargo:rerun-if-env-changed=APTABASE_APP_KEY");
    tauri_build::build()
}
