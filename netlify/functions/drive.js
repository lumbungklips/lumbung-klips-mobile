
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  });

export default async (req) => {
  const env = process.env;
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    GOOGLE_REFRESH_TOKEN,
    DRIVE_FOLDER_ID
  } = env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET ||
      !GOOGLE_REDIRECT_URI) {
    return json({
      error: "Konfigurasi OAuth Google belum lengkap."
    }, 500);
  }

  // 1. Mulai proses izin Google Drive
  if (action === "auth") {
    const state = crypto.randomUUID();

    const googleUrl = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );

    googleUrl.search = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.readonly",
      access_type: "offline",
      prompt: "consent",
      state
    }).toString();

    return new Response(null, {
      status: 302,
      headers: {
        Location: googleUrl.toString(),
        "Set-Cookie":
          `drive_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
      }
    });
  }

  // 2. Google mengembalikan kode otorisasi
  if (url.searchParams.has("code")) {
    const cookies = req.headers.get("cookie") || "";
    const savedState = cookies
      .split("; ")
      .find(v => v.startsWith("drive_oauth_state="))
      ?.split("=")[1];

    const returnedState = url.searchParams.get("state");

    if (!savedState || savedState !== returnedState) {
      return json({ error: "Verifikasi OAuth gagal." }, 403);
    }

    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          code: url.searchParams.get("code"),
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI,
          grant_type: "authorization_code"
        })
      }
    );

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return json({
        error: "Google gagal memberikan token.",
        details: tokens.error_description || tokens.error
      }, 400);
    }

    return json({
      message: "Otorisasi Google berhasil.",
      refresh_token: tokens.refresh_token || null,
      instruction:
        "Simpan refresh_token sebagai GOOGLE_REFRESH_TOKEN di Netlify. Jangan bagikan token ini."
    }, 200, {
      "Set-Cookie":
        "drive_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
    });
  }

  // 3. Membaca isi folder Google Drive
  if (action === "list") {
    if (!GOOGLE_REFRESH_TOKEN || !DRIVE_FOLDER_ID) {
      return json({
        error: "Refresh token atau ID folder belum diatur."
      }, 400);
    }

    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: GOOGLE_REFRESH_TOKEN,
          grant_type: "refresh_token"
        })
      }
    );

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return json({ error: "Gagal memperbarui akses Google." }, 401);
    }

    const query = `'${DRIVE_FOLDER_ID}' in parents and trashed = false`;

    const driveUrl = new URL(
      "https://www.googleapis.com/drive/v3/files"
    );

    driveUrl.search = new URLSearchParams({
      q: query,
      pageSize: "100",
      orderBy: "createdTime desc",
      fields: "files(id,name,mimeType,webViewLink,createdTime)"
    }).toString();

    const driveResponse = await fetch(driveUrl, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`
      }
    });

    const files = await driveResponse.json();

    if (!driveResponse.ok) {
      return json({ error: "Gagal membaca folder Drive." }, 400);
    }

    return json({
      folder: "LUMBUNG KLIPS - MATERI VIDEO",
      files: files.files || []
    });
  }

  return json({
    service: "LUMBUNG KLIPS Drive API",
    status: "ready",
    actions: ["auth", "list"]
  });
};
