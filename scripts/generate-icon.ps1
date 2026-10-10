Add-Type -AssemblyName System.Drawing
$taskBitmap = [System.Drawing.Bitmap]::new(1024,1024)
$taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
$taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$taskGraphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#235BD7'))
$taskHalo = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#3C70E4'))
$taskGraphics.FillEllipse($taskHalo,120,120,784,784)
$taskGraphics.TranslateTransform(512,512)
$taskGraphics.RotateTransform(-30)
$taskBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$taskGraphics.FillRectangle($taskBrush,-180,-38,360,76)
$taskGraphics.FillRectangle($taskBrush,-250,-180,85,360)
$taskGraphics.FillRectangle($taskBrush,165,-180,85,360)
$taskGraphics.FillRectangle($taskBrush,-315,-105,55,210)
$taskGraphics.FillRectangle($taskBrush,260,-105,55,210)
$taskTarget = Join-Path $PSScriptRoot '..\assets\icon.png'
$taskBitmap.Save($taskTarget,[System.Drawing.Imaging.ImageFormat]::Png)
$taskGraphics.Dispose()
$taskBrush.Dispose()
$taskHalo.Dispose()
$taskBitmap.Dispose()

