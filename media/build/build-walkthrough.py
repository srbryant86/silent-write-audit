"""
Build the silent-write-audit 90-second walkthrough video.

Pipeline:
  1. Generate per-scene audio via edge-tts (free, no API key)
  2. Generate per-scene slide PNGs via PIL
  3. Composite each scene as an MP4 (still image + audio) via ffmpeg
  4. Concatenate scenes into final MP4

Output: silent-write-audit-walkthrough.mp4 in ../

Reproducible — run again any time to regenerate. Commit the final MP4
to git; build/ stays gitignored (it's regenerable).
"""

import asyncio
import os
import shutil
import subprocess
from pathlib import Path

import edge_tts
from PIL import Image, ImageDraw, ImageFont

# ─── Config ────────────────────────────────────────────────────────────────

VOICE = "en-US-AndrewNeural"  # warm, confident, technical-friendly
SLIDE_W, SLIDE_H = 1280, 720
BUILD_DIR = Path(__file__).parent
MEDIA_DIR = BUILD_DIR.parent
OUT_FILE = MEDIA_DIR / "silent-write-audit-walkthrough.mp4"

# Color palette (matches README / dark dev tools aesthetic)
BG = (15, 23, 42)          # slate-900
FG = (248, 250, 252)       # slate-50
ACCENT = (16, 185, 129)    # emerald-500
DANGER = (239, 68, 68)     # red-500
MUTED = (148, 163, 184)    # slate-400
CODE_BG = (30, 41, 59)     # slate-800

# Try to load a clean monospace + sans font; fallback to default
def get_fonts():
    candidates_sans = [
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/calibri.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    candidates_mono = [
        "C:/Windows/Fonts/consolab.ttf",
        "C:/Windows/Fonts/consola.ttf",
        "C:/Windows/Fonts/cour.ttf",
    ]
    sans_path = next((p for p in candidates_sans if Path(p).exists()), None)
    mono_path = next((p for p in candidates_mono if Path(p).exists()), None)
    return sans_path, mono_path

SANS_PATH, MONO_PATH = get_fonts()

def font_sans(size):
    return ImageFont.truetype(SANS_PATH, size) if SANS_PATH else ImageFont.load_default()

def font_mono(size):
    return ImageFont.truetype(MONO_PATH, size) if MONO_PATH else ImageFont.load_default()

# ─── Scene script ──────────────────────────────────────────────────────────

# Each scene: (slide_filename_stub, narration_text, slide_render_fn)
# Narration optimized for TTS — natural pauses, no face-cam cues, dollar
# amounts spelled in a way edge-tts pronounces cleanly.

SCENES = []

def scene_1_hook():
    img = Image.new("RGB", (SLIDE_W, SLIDE_H), BG)
    d = ImageDraw.Draw(img)
    # Title centered
    title = "Silent-Write Audit"
    sub = "find phantom-column bugs in your Postgres + Stripe SaaS"
    f_title = font_sans(72)
    f_sub = font_sans(28)
    tw = d.textlength(title, font=f_title)
    sw = d.textlength(sub, font=f_sub)
    d.text(((SLIDE_W - tw) / 2, 280), title, fill=FG, font=f_title)
    d.text(((SLIDE_W - sw) / 2, 380), sub, fill=MUTED, font=f_sub)
    # Bottom URL hint
    url = "github.com/srbryant86/silent-write-audit"
    f_url = font_mono(20)
    uw = d.textlength(url, font=f_url)
    d.text(((SLIDE_W - uw) / 2, 640), url, fill=ACCENT, font=f_url)
    return img

NARRATION_1 = (
    "If you run a Postgres and Stripe SaaS, your webhooks are probably silently "
    "dropping writes right now. Here's how to find every one in seven days."
)

SCENES.append(("01-hook", NARRATION_1, scene_1_hook))


def scene_2_bug_class():
    img = Image.new("RGB", (SLIDE_W, SLIDE_H), BG)
    d = ImageDraw.Draw(img)
    # Header
    f_head = font_sans(32)
    d.text((80, 50), "The bug class", fill=ACCENT, font=f_head)
    # Code block background
    d.rectangle((80, 120, 1200, 460), fill=CODE_BG)
    # Code (split into lines for highlighting)
    f_code = font_mono(26)
    code_lines = [
        ("await supabase.from('disputes').update({", FG),
        ("  status: 'won',", FG),
        ("  won: true,", DANGER),
        ("  evidence_score: 87,", DANGER),
        ("})", FG),
    ]
    y = 150
    for line, color in code_lines:
        d.text((110, y), line, fill=color, font=f_code)
        y += 60
    # Annotation
    f_note = font_sans(22)
    d.text((720, 270), "← phantom columns", fill=DANGER, font=f_note)
    # Caption
    f_cap = font_sans(24)
    d.text((80, 510), "PostgREST silently rejects the entire UPDATE.", fill=FG, font=f_cap)
    d.text((80, 545), "PGRST204. No exception. One log line. Three weeks later", fill=MUTED, font=f_cap)
    d.text((80, 580), "you discover an entire feature was a no-op.", fill=MUTED, font=f_cap)
    return img

NARRATION_2 = (
    "PostgREST silently drops the entire UPDATE if any column doesn't exist on "
    "the target table. Your code looks fine, your logs get one error line, and "
    "three weeks later you discover an entire feature was a no-op. There's no "
    "exception, no test catches it, no production alarm fires."
)

SCENES.append(("02-bug-class", NARRATION_2, scene_2_bug_class))


def scene_3_findings():
    img = Image.new("RGB", (SLIDE_W, SLIDE_H), BG)
    d = ImageDraw.Draw(img)
    f_head = font_sans(32)
    d.text((80, 50), "What we found in our own codebase", fill=ACCENT, font=f_head)
    f_stat = font_sans(56)
    d.text((80, 110), "~50 bugs", fill=FG, font=f_stat)
    f_sub = font_sans(24)
    d.text((80, 180), "in a single night against ~80k lines of TypeScript", fill=MUTED, font=f_sub)
    # Bullet incidents
    f_bul = font_sans(22)
    bullets = [
        "Stripe dispute outcomes not persisting for weeks (won, evidence_score phantom)",
        "GDPR redaction handler — silent no-op (compliance hazard)",
        "connected_accounts.charges_enabled never flipping after Stripe deauth",
        "WooCommerce billing rows recording 0 of 5 fees per row",
        "Bitcoin Layer 3 verification 100% broken for 5+ weeks while cron returned",
        "  success: true every hour — three cascading silent bugs",
    ]
    y = 260
    for b in bullets:
        prefix = "  " if b.startswith("  ") else "•  "
        d.text((100, y), prefix + b.lstrip(), fill=FG, font=f_bul)
        y += 50
    return img

NARRATION_3 = (
    "We ran this on our own production codebase last week. About eighty thousand "
    "lines of TypeScript. Found roughly fifty of these bugs in a single night. "
    "The worst ones: Stripe dispute outcomes weren't persisting for weeks, a GDPR "
    "redaction handler was a silent no-op, and our Bitcoin timestamp verification "
    "cron returned success-true every hour while being one hundred percent broken "
    "for over a month."
)

SCENES.append(("03-findings", NARRATION_3, scene_3_findings))


def scene_4_deliverables():
    img = Image.new("RGB", (SLIDE_W, SLIDE_H), BG)
    d = ImageDraw.Draw(img)
    f_head = font_sans(32)
    d.text((80, 50), "What you get — $1,497 flat, 7 days", fill=ACCENT, font=f_head)
    f_bul = font_sans(28)
    items = [
        "Full audit (every .update / .upsert / .insert / .select / filter chain)",
        "Ranked findings list — scored by revenue impact",
        "Patch pull requests against your repo for the top 10 findings",
        "Pre-commit hook installed and configured to block new bugs",
    ]
    y = 180
    for i, it in enumerate(items, start=1):
        d.text((80, y), f"{i}.", fill=ACCENT, font=f_bul)
        d.text((140, y), it, fill=FG, font=f_bul)
        y += 80
    f_note = font_sans(22)
    d.text((80, 600), "No charge if we find fewer than 3 critical findings.", fill=MUTED, font=f_note)
    return img

NARRATION_4 = (
    "For one thousand four hundred and ninety-seven dollars flat, in seven "
    "calendar days, you get the audit, a ranked findings list scored by revenue "
    "impact, patch pull requests against your repo for the top ten issues, and "
    "a pre-commit hook installed so new ones get blocked before they ship."
)

SCENES.append(("04-deliverables", NARRATION_4, scene_4_deliverables))


def scene_5_pricing():
    img = Image.new("RGB", (SLIDE_W, SLIDE_H), BG)
    d = ImageDraw.Draw(img)
    f_head = font_sans(32)
    d.text((80, 50), "Three tiers", fill=ACCENT, font=f_head)
    # Three columns
    cols = [
        ("Findings", "$497", "audit + ranked list", "you ship the fixes", "3-day"),
        ("Full delivery", "$1,497", "audit + patch PRs", "+ pre-commit hook", "7-day"),
        ("Watch", "$4,997 / yr", "quarterly re-audits", "+ ongoing maintenance", "annual"),
    ]
    f_t = font_sans(34)
    f_p = font_sans(48)
    f_d = font_sans(20)
    col_w = SLIDE_W // 3
    for i, (name, price, l1, l2, t) in enumerate(cols):
        x = i * col_w
        # Box
        if i == 1:
            d.rectangle((x + 30, 130, x + col_w - 30, 580), fill=CODE_BG, outline=ACCENT, width=3)
        d.text((x + 60, 160), name, fill=FG, font=f_t)
        d.text((x + 60, 220), price, fill=ACCENT, font=f_p)
        d.text((x + 60, 310), l1, fill=FG, font=f_d)
        d.text((x + 60, 345), l2, fill=FG, font=f_d)
        d.text((x + 60, 400), f"turnaround: {t}", fill=MUTED, font=f_d)
    # FIRST5 callout
    f_callout = font_sans(24)
    d.text((80, 620), "First 5 customers (Full delivery): $1,197 with code FIRST5", fill=ACCENT, font=f_callout)
    return img

NARRATION_5 = (
    "First five customers get the FIRST5 founder discount — eleven hundred ninety "
    "seven dollars instead of fourteen ninety seven. No charge if we find fewer "
    "than three critical findings. Self-serve via the Stripe link in the README, "
    "or email contact at certnode dot io."
)

SCENES.append(("05-pricing", NARRATION_5, scene_5_pricing))


def scene_6_close():
    img = Image.new("RGB", (SLIDE_W, SLIDE_H), BG)
    d = ImageDraw.Draw(img)
    f_url = font_mono(36)
    f_caption = font_sans(28)
    f_email = font_mono(24)
    title = "github.com/srbryant86/silent-write-audit"
    tw = d.textlength(title, font=f_url)
    d.text(((SLIDE_W - tw) / 2, 250), title, fill=ACCENT, font=f_url)
    cap = "Free OSS tool. Pay only if you want us to do the triage and ship the PRs."
    cw = d.textlength(cap, font=f_caption)
    d.text(((SLIDE_W - cw) / 2, 360), cap, fill=FG, font=f_caption)
    email = "contact@certnode.io"
    ew = d.textlength(email, font=f_email)
    d.text(((SLIDE_W - ew) / 2, 480), email, fill=MUTED, font=f_email)
    return img

NARRATION_6 = (
    "The repo is at github dot com slash srbryant eighty six slash silent dash "
    "write dash audit. Run it free. Pay only if you want us to do the triage "
    "and ship the PRs."
)

SCENES.append(("06-close", NARRATION_6, scene_6_close))


# ─── Generation ────────────────────────────────────────────────────────────

async def generate_audio(text: str, out_path: Path) -> None:
    communicate = edge_tts.Communicate(text, VOICE)
    await communicate.save(str(out_path))


async def build_all():
    print(f"Build dir: {BUILD_DIR}")
    print(f"Output: {OUT_FILE}")
    print(f"Voice: {VOICE}")
    print()

    # Step 1: generate audio + slides per scene
    scene_files = []
    for stub, narration, slide_fn in SCENES:
        png_path = BUILD_DIR / f"{stub}.png"
        mp3_path = BUILD_DIR / f"{stub}.mp3"
        mp4_path = BUILD_DIR / f"{stub}.mp4"
        print(f"Scene {stub}: rendering slide…")
        slide_fn().save(png_path)
        print(f"Scene {stub}: generating audio ({len(narration)} chars)…")
        await generate_audio(narration, mp3_path)
        # Step 2: composite this scene's MP4
        print(f"Scene {stub}: compositing MP4…")
        cmd = [
            "ffmpeg", "-y",
            "-loop", "1",
            "-i", str(png_path),
            "-i", str(mp3_path),
            "-c:v", "libx264",
            "-tune", "stillimage",
            "-c:a", "aac",
            "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            "-shortest",
            "-r", "30",
            str(mp4_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"ffmpeg failed for {stub}:")
            print(result.stderr[-500:])
            return
        scene_files.append(mp4_path)
        print()

    # Step 3: concatenate scenes
    print("Concatenating scenes…")
    concat_list = BUILD_DIR / "concat-list.txt"
    concat_list.write_text("\n".join(f"file '{p.name}'" for p in scene_files))
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(concat_list),
        "-c", "copy",
        str(OUT_FILE),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BUILD_DIR))
    if result.returncode != 0:
        print("ffmpeg concat failed:")
        print(result.stderr[-500:])
        return

    size_mb = OUT_FILE.stat().st_size / 1024 / 1024
    print(f"\n[OK] Done. Output: {OUT_FILE}")
    print(f"     Size: {size_mb:.2f} MB")


if __name__ == "__main__":
    asyncio.run(build_all())
