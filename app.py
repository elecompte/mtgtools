from flask import Flask, render_template, request, redirect, url_for

app = Flask(__name__)



@app.route('/')
def index():
    return render_template('index.html')

@app.route('/scuteswarm', methods=['GET', 'POST'])
def scuteswarm():
    final_swarms = None
    initial = 0
    lands = 0
    if request.method == 'POST':
        try:
            initial = int(request.form['initial'])
            lands = int(request.form['lands'])
            final_swarms = initial * (2 ** lands)
            initial = final_swarms
        except Exception:
            final_swarms = None
    return render_template('scuteswarm.html', final_swarms=final_swarms, initial=initial, lands=lands)

if __name__ == "__main__":
    app.run(debug=True)
    app.run(host='0.0.0.0')
