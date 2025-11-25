import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";

export function configureFfmpeg() {
  ffmpeg.setFfprobePath(ffprobe.path);
  ffmpeg.setFfmpegPath(ffmpegPath);
}
