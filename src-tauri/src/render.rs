//! What the grid needs to draw cells: shown text, value type and a style,
//! with theme colors resolved to hex.

use ironcalc_base::types::{BorderItem, BorderStyle, CellType, Color, HorizontalAlignment, Style, VerticalAlignment};
use ironcalc_base::UserModel;
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct BorderDto {
    pub style: &'static str,
    pub color: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StyleDto {
    pub b: bool,
    pub i: bool,
    pub u: bool,
    pub s: bool,
    pub size: i32,
    /// None is the automatic text color.
    pub color: Option<String>,
    pub fill: Option<String>,
    /// "left", "center", "right", or "" for automatic (numbers right, text left).
    pub h: &'static str,
    /// "top", "center" or "bottom".
    pub v: &'static str,
    pub wrap: bool,
    pub fmt: String,
    pub top: Option<BorderDto>,
    pub right: Option<BorderDto>,
    pub bottom: Option<BorderDto>,
    pub left: Option<BorderDto>,
}

fn color(model: &UserModel, color: &Color) -> Option<String> {
    match color {
        Color::None => None,
        c => Some(model.resolve_color(c)).filter(|hex| !hex.is_empty()),
    }
}

fn border(model: &UserModel, item: &Option<BorderItem>) -> Option<BorderDto> {
    let item = item.as_ref()?;
    let style = match item.style {
        BorderStyle::Thin => "thin",
        BorderStyle::Medium => "medium",
        BorderStyle::Thick => "thick",
        BorderStyle::Double => "double",
        BorderStyle::Dotted => "dotted",
        _ => "dashed",
    };
    Some(BorderDto { style, color: color(model, &item.color) })
}

pub fn style_dto(model: &UserModel, style: &Style) -> StyleDto {
    let alignment = style.alignment.clone().unwrap_or_default();
    // Black is how most files spell the automatic color; the grid then uses the
    // theme's text color so dark mode stays readable.
    let font_color = color(model, &style.font.color).filter(|c| !c.eq_ignore_ascii_case("#000000"));
    StyleDto {
        b: style.font.b,
        i: style.font.i,
        u: style.font.u,
        s: style.font.strike,
        size: style.font.sz,
        color: font_color,
        fill: color(model, &style.fill.color),
        h: match alignment.horizontal {
            HorizontalAlignment::Left | HorizontalAlignment::Justify | HorizontalAlignment::Distributed => "left",
            HorizontalAlignment::Center | HorizontalAlignment::CenterContinuous => "center",
            HorizontalAlignment::Right => "right",
            HorizontalAlignment::General | HorizontalAlignment::Fill => "",
        },
        v: match alignment.vertical {
            VerticalAlignment::Top => "top",
            VerticalAlignment::Center | VerticalAlignment::Justify | VerticalAlignment::Distributed => "center",
            VerticalAlignment::Bottom => "bottom",
        },
        wrap: alignment.wrap_text,
        fmt: style.num_fmt.clone(),
        top: border(model, &style.border.top),
        right: border(model, &style.border.right),
        bottom: border(model, &style.border.bottom),
        left: border(model, &style.border.left),
    }
}

/// Value type of a cell for alignment: 0 empty, 1 number, 2 text, 3 TRUE/FALSE, 4 error.
pub fn kind(model: &UserModel, sheet: u32, row: i32, col: i32, text: &str) -> u8 {
    if text.is_empty() {
        return 0;
    }
    match model.get_cell_type(sheet, row, col) {
        Ok(CellType::Number) => 1,
        Ok(CellType::LogicalValue) => 3,
        Ok(CellType::ErrorValue) => 4,
        _ => 2,
    }
}
