use calamine::Data;
use rust_xlsxwriter::Worksheet;

pub fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::String(s) => s.to_string(),
        Data::Float(f) => f.to_string(),
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(d) => d.to_string(),
        Data::Empty => String::new(),
        _ => cell.to_string(),
    }
}

pub fn write_cell(
    sheet: &mut Worksheet,
    row: u32,
    col: u16,
    cell: &Data,
) -> Result<(), rust_xlsxwriter::XlsxError> {
    match cell {
        Data::String(s) => {
            sheet.write_string(row, col, s)?;
        }
        Data::Float(f) => {
            sheet.write_number(row, col, *f)?;
        }
        Data::Int(i) => {
            sheet.write_number(row, col, *i as f64)?;
        }
        Data::Bool(b) => {
            sheet.write_boolean(row, col, *b)?;
        }
        Data::DateTime(d) => {
            sheet.write_string(row, col, &d.to_string())?;
        }
        Data::DateTimeIso(d) => {
            sheet.write_string(row, col, d)?;
        }
        Data::DurationIso(d) => {
            sheet.write_string(row, col, d)?;
        }
        Data::Error(e) => {
            sheet.write_string(row, col, &e.to_string())?;
        }
        _ => (),
    }
    Ok(())
}
