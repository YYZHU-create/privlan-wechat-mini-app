param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][int]$MaxEdge,
  [Parameter(Mandatory = $true)][int]$Quality
)

Add-Type -AssemblyName System.Drawing
$image = [Drawing.Image]::FromFile($Source)

try {
  $longEdge = [Math]::Max($image.Width, $image.Height)
  if ($longEdge -le $MaxEdge) { exit 0 }

  $scale = $MaxEdge / $longEdge
  $width = [Math]::Max(1, [int][Math]::Round($image.Width * $scale))
  $height = [Math]::Max(1, [int][Math]::Round($image.Height * $scale))
  $bitmap = New-Object Drawing.Bitmap($width, $height)

  try {
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($image, 0, 0, $width, $height)
      $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
      $parameters = New-Object Drawing.Imaging.EncoderParameters(1)
      try {
        $parameters.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]$Quality)
        $bitmap.Save($Target, $codec, $parameters)
      } finally {
        $parameters.Dispose()
      }
    } finally {
      $graphics.Dispose()
    }
  } finally {
    $bitmap.Dispose()
  }
} finally {
  $image.Dispose()
}
