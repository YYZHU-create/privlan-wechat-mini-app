param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][double]$Zoom,
  [Parameter(Mandatory = $true)][double]$OffsetX,
  [Parameter(Mandatory = $true)][double]$OffsetY
)

Add-Type -AssemblyName System.Drawing
$size = 512
$image = [Drawing.Image]::FromFile($Source)

try {
  $scale = [Math]::Max($size / $image.Width, $size / $image.Height) * [Math]::Max(1, [Math]::Min(3, $Zoom))
  $width = $image.Width * $scale
  $height = $image.Height * $scale
  $maxX = [Math]::Max(0, ($width - $size) / 2)
  $maxY = [Math]::Max(0, ($height - $size) / 2)
  $left = ($size - $width) / 2 + [Math]::Max(-1, [Math]::Min(1, $OffsetX)) * $maxX
  $top = ($size - $height) / 2 + [Math]::Max(-1, [Math]::Min(1, $OffsetY)) * $maxY
  $bitmap = New-Object Drawing.Bitmap($size, $size)

  try {
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([Drawing.Color]::White)
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($image, [Drawing.RectangleF]::new([single]$left, [single]$top, [single]$width, [single]$height))
      $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
      $parameters = New-Object Drawing.Imaging.EncoderParameters(1)
      try {
        $parameters.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]92)
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
