-- BlindFake Cinematic Script
-- Example: Game Intro

cinematic.name = "Intro - The Fall"
cinematic.duration = 25

-- Scene starts with a wide shot of the city
keyframe(0, {
  camera_pos = {0, 50, 100},
  camera_look = {0, 10, 0},
  camera_fov = 45,
  letterbox = true,
  fade_alpha = 1,
  fade_color = "#000000"
})

-- Fade in, camera descends
keyframe(2, {
  camera_pos = {0, 50, 100},
  camera_look = {0, 10, 0},
  camera_fov = 45,
  fade_alpha = 0
})

-- Camera swoops down to street level
keyframe(6, {
  camera_pos = {10, 5, 20},
  camera_look = {0, 2, 0},
  camera_fov = 60,
  subtitle = "The world we knew... it was never meant to last.",
  speaker = "Narrator"
})

-- Close up on protagonist
keyframe(10, {
  camera_pos = {2, 2, 5},
  camera_look = {0, 1.6, 0},
  camera_fov = 50,
  subtitle = "We were blind to the truth hiding in plain sight.",
  speaker = "Narrator"
})

-- Camera orbits around
keyframe(15, {
  camera_pos = {-5, 3, 3},
  camera_look = {0, 1.6, 0},
  camera_fov = 55,
  subtitle = "",
  event = "play_theme_music"
})

-- Pull back to reveal the scale of destruction
keyframe(20, {
  camera_pos = {0, 30, 60},
  camera_look = {0, 5, 0},
  camera_fov = 40,
  subtitle = "But some of us... chose to fight.",
  speaker = "Narrator",
  event = "start_particles_debris"
})

-- Final frame - fade to black
keyframe(25, {
  camera_pos = {0, 40, 80},
  camera_look = {0, 10, 0},
  camera_fov = 35,
  letterbox = true,
  subtitle = "",
  fade_alpha = 1,
  fade_color = "#000000",
  event = "cinematic_end"
})
